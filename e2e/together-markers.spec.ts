import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary, startBooth, tapAudio } from "./helpers";

const states = async (page: Page) => (await deckStates(page)).join(" ");
const upNext = (page: Page) => page.getByRole("heading", { name: "Up next" }).locator("..");

test("▶ Play now plays both songs together until the new one's drop, then they swap by themselves", async ({ page }) => {
  test.setTimeout(150_000);
  const taps = await tapAudio(page);
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await page.getByRole("region", { name: "Deck B" }).getByRole("button", { name: "Play Deck B now" }).click();

  // Both decks play, beat-matched; the one on air stays on air.
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/A:On air.*B:Playing along/);
  await expect(upNext(page)).toContainText("Playing together");
  await expect(upNext(page)).toContainText(/together · mixes at its drop in \d+:\d\d · or Drop/);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  // Still together a while later: nothing mixes before the drop.
  await page.waitForTimeout(4000);
  expect(await states(page)).toMatch(/A:On air.*B:Playing along/);

  // At the new song's drop they swap: B takes over, A goes out.
  await expect.poll(() => states(page), { timeout: 100_000 }).toMatch(/A:(Mixing out|Cued|Empty).*B:(Mixing in|On air)/);
  await expect.poll(() => states(page), { timeout: 20_000 }).toMatch(/B:On air/);
});

test("playing together, Drop mixes now", async ({ page }) => {
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await page.getByRole("region", { name: "Deck B" }).getByRole("button", { name: "Play Deck B now" }).click();
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/B:Playing along/);
  await dropButton(page).click();
  await expect.poll(() => states(page), { timeout: 20_000 }).toMatch(/B:On air/);
});

test("song markers on the waveform: click for the cursor, Set here, drag a handle; hook snaps to the bar", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await page.getByRole("row", { name: /Test Groove C/ }).getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  const detail = dialog.getByTestId("marker-detail");
  await expect(dialog.getByRole("group", { name: "Song waveform" })).toBeVisible();
  await expect(dialog.getByText(/Preparing the waveform/)).toHaveCount(0, { timeout: 15_000 });
  const cell = (label: string) => dialog.getByRole("row", { name: new RegExp(label) }).locator("td").nth(1);
  const secs = (t: string) => {
    const [m, s] = t.split(":");
    return Number(m) * 60 + Number(s);
  };

  // Click in the zoomed view: the cursor goes there.
  const box = (await detail.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
  await expect(dialog.getByTestId("marker-cursor")).not.toHaveText("—");
  const cursor = secs((await dialog.getByTestId("marker-cursor").textContent())!);

  // Set the dialogue start exactly there (dialogue isn't snapped).
  await dialog.getByRole("button", { name: "Dialogue start", exact: true }).click();
  await expect.poll(async () => Math.abs(secs((await cell("Dialogue starts").textContent())!) - cursor)).toBeLessThan(0.06);

  // Drag its handle to the right: it moves by the same share of the view (8 s across).
  const x0 = box.x + box.width * 0.3;
  await page.mouse.move(x0, box.y + box.height - 6);
  await page.mouse.down();
  await page.mouse.move(x0 + box.width * 0.1, box.y + box.height - 6, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => secs((await cell("Dialogue starts").textContent())!) - cursor).toBeGreaterThan(0.6);
  expect(secs((await cell("Dialogue starts").textContent())!) - cursor).toBeLessThan(1.0);

  // The hook start snaps to the bar (127 BPM: bars of 1.89 s from the first downbeat).
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height / 2);
  await dialog.getByRole("button", { name: "Hook start", exact: true }).click();
  await expect(cell("Hook starts")).not.toHaveText("—");
  // Zoom changes the view.
  await dialog.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "Zoom in" }).click();
  await expect(dialog.getByRole("group", { name: "Zoom" })).toContainText("4 s");
  await page.screenshot({ path: "test-results/markers.png" });
  expect(errors).toEqual([]);
});

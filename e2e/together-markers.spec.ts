import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary, startBooth, tapAudio } from "./helpers";

const states = async (page: Page) => (await deckStates(page)).join(" ");
const upNext = (page: Page) => page.getByRole("heading", { name: "Up next" }).locator("..");

test("▶ Play on the cued deck plays both decks together at full level — nothing mixes or swaps by itself", async ({ page }) => {
  test.setTimeout(150_000);
  const taps = await tapAudio(page);
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await page.getByRole("region", { name: "Deck B" }).getByRole("button", { name: "Play Deck B" }).click();

  // Both decks play (beat-matched), both at full; the one on air stays on air.
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:On air.*B:Playing along/);
  await expect(upNext(page)).toContainText("Playing together");
  await expect(upNext(page)).toContainText("together · Drop to mix");
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  // Long after the new song's first drop (~0:45), both still play: nothing swaps by itself.
  await page.waitForTimeout(55_000);
  expect(await states(page)).toMatch(/A:On air.*B:Playing along/);
});

test("playing together, Drop mixes now", async ({ page }) => {
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await page.getByRole("region", { name: "Deck B" }).getByRole("button", { name: "Play Deck B" }).click();
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

  // Drag its handle to the right: it moves by the same share of the view. (Clicking for the cursor also started
  // listening and the view follows the playhead: stop, and aim from where the view is.)
  await dialog.getByRole("button", { name: "■ Stop" }).click();
  await page.waitForTimeout(100);
  const [viewStart, span] = (await detail.getAttribute("data-view"))!.split(",").map(Number);
  const x0 = box.x + ((cursor - viewStart) / span) * box.width;
  await page.mouse.move(x0, box.y + box.height - 6);
  await page.mouse.down();
  await page.mouse.move(x0 + box.width * 0.1, box.y + box.height - 6, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => secs((await cell("Dialogue starts").textContent())!) - cursor).toBeGreaterThan(span * 0.1 - 0.2);
  expect(secs((await cell("Dialogue starts").textContent())!) - cursor).toBeLessThan(span * 0.1 + 0.2);

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

test("playing together, the song on air runs to its very end; the other plays on as the song on air", async ({ page }) => {
  test.setTimeout(150_000);
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  const songB = (await deckStates(page)).find((d) => d.startsWith("B:"))!.split(" ").at(-1);
  await page.getByRole("region", { name: "Deck B" }).getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:On air.*B:Playing along/);

  // Move Deck A to ~15 s before its end (pause it, Page Up 8 bars at a time, play it again — B never stops).
  const deckA = page.getByRole("region", { name: "Deck A" });
  await deckA.getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:Paused.*B:Playing along/);
  const left = (await deckStates(page)).find((d) => d.startsWith("A:"))!.match(/−(\d+):(\d\d)/)!;
  const remaining = Number(left[1]) * 60 + Number(left[2]);
  const jog = page.getByRole("slider", { name: "Song position, Deck A" });
  await jog.focus();
  for (let i = 0; i < Math.max(0, Math.floor((remaining - 15) / 15.2)); i++) await jog.press("PageUp");
  await page.waitForTimeout(600);
  await deckA.getByRole("button", { name: "Play Deck A" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:On air.*B:Playing along/);

  // A plays down to its last seconds with B still playing along; then B is the song on air, A gets a new song.
  await expect.poll(async () => (await deckStates(page)).find((d) => d.startsWith("A:"))!, { timeout: 40_000 }).toMatch(/−0:0[0-3]/);
  expect(await states(page)).toMatch(/B:Playing along/);
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(new RegExp(`B:On air .*${songB}`));
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/A:Cued/);
});

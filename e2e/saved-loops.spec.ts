import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary, startBooth } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const states = async (page: Page) => (await deckStates(page)).join(" ");
const played = async (page: Page, letter: string) => {
  const m = (await deckStates(page)).find((d) => d.startsWith(`${letter}:`))!.match(/(\d+):(\d\d) \//);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const secs = (t: string) => {
  const [m, s] = t.split(":");
  return Number(m) * 60 + Number(s);
};
const upNext = (page: Page) => page.getByRole("heading", { name: "Up next" }).locator("..");

test("saved loops: made on the editor's waveform, dragged on the beat, then looping the song on air", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await page.getByRole("row", { name: /Test Groove A/ }).getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  const detail = dialog.getByTestId("marker-detail");
  const loops = dialog.getByRole("group", { name: "Saved loops" });
  await expect(dialog.getByText(/Preparing the waveform/)).toHaveCount(0, { timeout: 15_000 });

  // Look near 0:06, click there for the cursor, save a 2-bar loop (it starts on a bar).
  const overview = dialog.getByRole("group", { name: "Song waveform" }).locator("canvas").first();
  const ob = (await overview.boundingBox())!;
  const duration = 137;
  await page.mouse.click(ob.x + (ob.width * 6) / duration, ob.y + ob.height / 2);
  const box = (await detail.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await loops.getByRole("button", { name: "2 bars" }).click();
  const chip = loops.getByText(/^L1 /);
  await expect(chip).toBeVisible();
  const [s0, e0] = (await chip.textContent())!.replace(/^L1 /, "").replace(/[▶✕]/g, "").split("–").map((x) => secs(x.trim()));
  expect(e0 - s0).toBeCloseTo((2 * 4 * 60) / 126, 1);

  // Drag its end one beat to the right: it lands one beat later, on the grid.
  const beat = 60 / 126;
  // (Clicking for the cursor also started listening, and the view follows the playhead: stop, and look at 0:08 —
  // the zoomed view then shows 0:04–0:12, with the loop's end inside it.)
  await dialog.getByRole("button", { name: "■ Stop" }).click();
  await page.mouse.click(ob.x + (ob.width * 8) / duration, ob.y + ob.height / 2);
  await page.waitForTimeout(100);
  const [viewStart, span] = (await detail.getAttribute("data-view"))!.split(",").map(Number);
  const xEnd = box.x + ((e0 - viewStart) / span) * box.width;
  await page.mouse.move(xEnd, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(xEnd + (beat / span) * box.width, box.y + 6, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => secs((await chip.textContent())!.replace(/^L1 /, "").replace(/[▶✕]/g, "").split("–")[1].trim()) - e0)
    .toBeGreaterThan(beat - 0.06);
  const e1 = secs((await chip.textContent())!.replace(/^L1 /, "").replace(/[▶✕]/g, "").split("–")[1].trim());
  expect(e1 - e0).toBeLessThan(beat + 0.06);

  // Delete it, and make a 4-bar one for the booth.
  await dialog.getByRole("button", { name: "Delete loop 1" }).click();
  await expect(chip).toHaveCount(0);
  await loops.getByRole("button", { name: "4 bars" }).click();
  await expect(loops.getByText(/^L1 /)).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  // On the booth: load it into Deck A, play, and press its saved loop: the song keeps coming back to it.
  await page.click("nav >> text=Booth");
  await deck(page, "A").getByRole("button", { name: "Load track" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove A" }).getByRole("button").last().click();
  await page.locator("button[aria-busy]").click();
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air/);
  const saved = deck(page, "A").getByRole("button", { name: /^Saved loop 1, Bar \d+\.\d, Deck A$/ });
  await saved.click();
  await expect(saved).toHaveAttribute("aria-pressed", "true");
  await expect(upNext(page)).toContainText("After the loop");
  // A 4-bar loop is ~7.6 s; after 12 s the song is still inside it (it jumped there on the beat).
  await page.waitForTimeout(12_000);
  const t = await played(page, "A");
  expect(t).toBeGreaterThanOrEqual(s0 - 1);
  expect(t).toBeLessThanOrEqual(s0 + 8);
  await saved.click();
  await expect(saved).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("a loop on the cued deck: armed before it plays, it loops while playing together until Drop lets it go", async ({ page }) => {
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);

  // Arm an 8-beat loop on the cued song, then ▶ Play: it comes in looping.
  const loopB = page.getByRole("button", { name: "Loop 8 beats, Deck B" });
  await loopB.click();
  await expect(loopB).toHaveAttribute("aria-pressed", "true");
  await expect(deck(page, "B").getByRole("button", { name: "Don't loop" })).toBeVisible();
  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/A:On air.*B:Playing along/);
  await expect(deck(page, "B").getByRole("button", { name: "Exit loop" })).toBeVisible();
  // It keeps looping (8 beats ≈ 3.8 s): its time stays put, and nothing mixes on its own.
  await expect(upNext(page)).toContainText("together · Drop to mix");
  await page.waitForTimeout(9000);
  expect(await played(page, "B")).toBeLessThanOrEqual(5);
  expect(await states(page)).toMatch(/A:On air.*B:Playing along/);

  // Drop: the loop lets go and the new song takes over.
  await dropButton(page).click();
  await expect(loopB).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => states(page), { timeout: 20_000 }).toMatch(/B:On air/);
  const after = await played(page, "B");
  await expect.poll(() => played(page, "B"), { timeout: 10_000 }).toBeGreaterThanOrEqual(after + 3);
});

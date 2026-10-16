import { expect, test, type Locator, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary, startBooth, tapAudio } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const states = async (page: Page) => (await deckStates(page)).join(" ");
/** Seconds played on a deck, from its "0:12 / −3:40" read-out. */
const played = async (page: Page, letter: string) => {
  const m = (await deckStates(page)).find((d) => d.startsWith(`${letter}:`))!.match(/(\d+):(\d\d) \//);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Press and hold a button with the mouse (until `page.mouse.up()`). */
async function hold(page: Page, button: Locator) {
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

/** Turn a jog wheel `turns` times forward and let go. */
async function spin(page: Page, jog: Locator, turns: number) {
  const box = (await jog.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.width * 0.35;
  await page.mouse.move(cx, cy - r);
  await page.mouse.down();
  const steps = Math.round(turns * 24);
  for (let i = 1; i <= steps; i++) {
    const t = ((2 * Math.PI) / 24) * i;
    await page.mouse.move(cx + r * Math.sin(t), cy - r * Math.cos(t));
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
}

test("one Play / Pause button per deck, and CUE works like a CDJ's on the song on air", async ({ page }) => {
  const taps = await tapAudio(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await expect.poll(() => played(page, "A"), { timeout: 20_000 }).toBeGreaterThanOrEqual(6);
  const cueA = deck(page, "A").getByRole("button", { name: "Cue Deck A" });

  // Play / Pause is one button: ⏸ while it plays, ▶ Play when it's stopped (never "Resume").
  await expect(deck(page, "A").getByRole("button", { name: "Pause Deck A" })).toHaveText("⏸ Pause");
  await expect(deck(page, "B").getByRole("button", { name: "Play Deck B" })).toHaveText("▶ Play");

  // Playing: CUE goes back to the cue point (where the song started) and stops there.
  await cueA.click();
  await expect.poll(() => states(page)).toMatch(/A:Paused/);
  await expect(deck(page, "A").getByRole("button", { name: "Play Deck A" })).toHaveText("▶ Play");
  const cuePoint = await played(page, "A");
  expect(cuePoint).toBeLessThanOrEqual(2);
  // (The level meter looks back ~0.7 s: let the stop fall out of it.)
  await page.waitForTimeout(800);
  await taps.reset();
  await page.waitForTimeout(1200);
  expect((await taps.get()).pre).toBeLessThan(0.001);
  expect(await states(page)).toMatch(/B:Cued/);

  // Stopped at the cue point: holding CUE plays from it; letting go goes back there, stopped.
  await hold(page, cueA);
  await expect.poll(() => states(page)).toMatch(/A:On air/);
  await taps.reset();
  await page.waitForTimeout(2500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  expect(await played(page, "A")).toBeGreaterThanOrEqual(cuePoint + 1);
  await page.mouse.up();
  await expect.poll(() => states(page)).toMatch(/A:Paused/);
  expect(await played(page, "A")).toBe(cuePoint);
  await page.waitForTimeout(800);
  await taps.reset();
  await page.waitForTimeout(1000);
  expect((await taps.get()).pre).toBeLessThan(0.001);

  // Moved with the wheel, CUE sets the cue point there — silently, still stopped.
  await spin(page, page.getByRole("slider", { name: "Song position, Deck A" }), 4);
  await page.waitForTimeout(300);
  const moved = await played(page, "A");
  expect(moved).toBeGreaterThanOrEqual(cuePoint + 5);
  await taps.reset();
  await cueA.click();
  await page.waitForTimeout(800);
  expect((await taps.get()).pre).toBeLessThan(0.001);
  expect(await states(page)).toMatch(/A:Paused/);

  // Now holding CUE plays from the new cue point, and ▶ while holding keeps it playing.
  await cueA.focus();
  await page.keyboard.down(" ");
  await expect.poll(() => states(page)).toMatch(/A:On air/);
  await deck(page, "A").getByRole("button", { name: "Play Deck A" }).click();
  await page.keyboard.up(" ");
  await page.waitForTimeout(1500);
  expect(await states(page)).toMatch(/A:On air/);
  expect(await played(page, "A")).toBeGreaterThanOrEqual(moved);
  await taps.reset();
  await page.waitForTimeout(1000);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);

  // Then CUE again: back to the new cue point, stopped.
  await cueA.click();
  await expect.poll(() => states(page)).toMatch(/A:Paused/);
  expect(Math.abs((await played(page, "A")) - moved)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("CUE on the cued deck plays it from its start point while held; let go, it waits — and the auto-DJ leaves it alone", async ({ page }) => {
  const taps = await tapAudio(page);
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  const cueB = deck(page, "B").getByRole("button", { name: "Cue Deck B" });
  await expect(cueB).toBeEnabled();

  await hold(page, cueB);
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:On air.*B:Playing along/);
  await page.waitForTimeout(2000);
  expect(await played(page, "B")).toBeGreaterThanOrEqual(1);
  await page.mouse.up();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:On air.*B:Cued/);
  // Staff cued it: it comes in when Deck A's song ends, not by an automatic mix.
  await expect(page.getByText("After this song")).toBeVisible();
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  expect(await states(page)).toMatch(/A:On air.*B:Cued/);

  // ▶ still plays it together, and Drop still mixes.
  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/B:Playing along/);
  await dropButton(page).click();
  await expect.poll(() => states(page), { timeout: 20_000 }).toMatch(/B:On air/);
});

test("nothing is locked during the auto-DJ's own mix: loops, tempo, cue pads and ⏸ work on both decks", async ({ page }) => {
  const taps = await tapAudio(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  // Drop starts the auto-DJ's own mix (a build-up into the drop) within seconds.
  await dropButton(page).click();
  await expect.poll(() => states(page), { timeout: 20_000 }).toMatch(/B:Mixing in/);

  // During the mix every control on both decks is enabled.
  for (const l of ["A", "B"]) {
    await expect(deck(page, l).getByRole("slider", { name: `Tempo, Deck ${l}` })).toBeEnabled();
    await expect(deck(page, l).getByRole("button", { name: `Loop 4 beats, Deck ${l}` })).toBeEnabled();
    await expect(deck(page, l).getByRole("button", { name: `Save cue A, Deck ${l}` })).toBeEnabled();
    await expect(deck(page, l).getByRole("button", { name: `Cue Deck ${l}` })).toBeEnabled();
    await expect(deck(page, l).getByRole("button", { name: `Pause Deck ${l}` })).toBeEnabled();
  }
  // A loop on the incoming song, mid-mix: it loops.
  await deck(page, "B").getByRole("button", { name: "Loop 4 beats, Deck B" }).click();
  await expect(deck(page, "B").getByRole("button", { name: "Loop 4 beats, Deck B" })).toHaveAttribute("aria-pressed", "true");
  // ⏸ on the song going out, mid-mix: just that deck stops; the incoming one plays on.
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:Paused.*B:(Playing along|On air)/);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  expect(await states(page)).toMatch(/A:Paused/);
  // ▶ brings it back; both play.
  await deck(page, "A").getByRole("button", { name: "Play Deck A" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:On air.*B:Playing along/);
  expect(errors).toEqual([]);
});

test("before the set, ▶ on a loaded deck starts the set with that song, on that deck", async ({ page }) => {
  await loadLibrary(page);
  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: /^Groove/ }).click();
  await expect(deck(page, "B").getByRole("button", { name: "Play Deck B" })).toBeDisabled();
  await deck(page, "B").getByRole("button", { name: "Load track" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove C" }).getByRole("button").last().click();
  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:Cued.*B:On air .*Test Groove C/);
});

import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary, startBooth, tapAudio, upNext } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const states = async (page: Page) => (await deckStates(page)).join(" ");
const played = async (page: Page, letter: string) => {
  const m = (await deckStates(page)).find((d) => d.startsWith(`${letter}:`))!.match(/(\d+):(\d\d) \//);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

test("loops: the song repeats a few beats until let go, the next mix waits; Drop ends a loop", async ({ page }) => {
  const taps = await tapAudio(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await expect.poll(() => played(page, "A"), { timeout: 15_000 }).toBeGreaterThanOrEqual(3);

  // A 4-beat loop (about 1.9 s at 126 BPM): the time stays put while it repeats, the music plays on.
  // The pads' BEAT LOOP mode.
  await page.getByRole("button", { name: "Beat loop pads, Deck A" }).click();
  const loop4 = page.getByRole("button", { name: "Loop 4 beats, Deck A" });
  await loop4.click();
  await expect(loop4).toHaveAttribute("aria-pressed", "true");
  const at = await played(page, "A");
  await expect(upNext(page)).toContainText("After the loop");
  await page.waitForTimeout(6000);
  expect(await played(page, "A")).toBeLessThanOrEqual(at + 2);
  await taps.reset();
  await page.waitForTimeout(1200);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);

  // Another length resizes it; Exit lets the song carry on and the mix is planned again.
  await page.getByRole("button", { name: "Loop 1 beat, Deck A" }).click();
  await expect(page.getByRole("button", { name: "Loop 1 beat, Deck A" })).toHaveAttribute("aria-pressed", "true");
  await expect(loop4).toHaveAttribute("aria-pressed", "false");
  await deck(page, "A").getByRole("button", { name: "Exit loop" }).click();
  await expect(upNext(page)).not.toContainText("After the loop");
  const freed = await played(page, "A");
  await expect.poll(() => played(page, "A"), { timeout: 10_000 }).toBeGreaterThanOrEqual(freed + 3);

  // Pressing the lit length lets it go too.
  await loop4.click();
  await loop4.click();
  await expect(loop4).toHaveAttribute("aria-pressed", "false");

  // Loop, then Drop: the loop ends and the next song comes in on its drop.
  await loop4.click();
  await expect(loop4).toHaveAttribute("aria-pressed", "true");
  await dropButton(page).click();
  await expect(loop4).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => states(page), { timeout: 20_000 }).toMatch(/B:Mixing in/);
  expect(errors).toEqual([]);
});

test("AI DJ off: no automatic mix and no Drop countdown — each song plays to its end, the next starts after; AI DJ stays off", async ({ page }) => {
  test.setTimeout(150_000);
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  const ai = page.getByRole("switch", { name: "AI DJ" });
  await expect(ai).toHaveAttribute("aria-checked", "true");

  // Off: the cued song comes after this one ends — no "waits for Drop" countdown.
  await ai.click();
  await expect(ai).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(/No automatic mixing: each song plays to its end/)).toBeVisible();
  await expect(upNext(page)).toContainText("After this song");
  await expect(upNext(page)).not.toContainText("waits for Drop");

  // Drop still mixes by hand, and AI DJ stays off for the next one.
  await dropButton(page).click();
  await expect.poll(() => states(page), { timeout: 20_000 }).toMatch(/B:Mixing in/);
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:Cued.*B:On air/);
  await expect(ai).toHaveAttribute("aria-checked", "false");
  await expect(upNext(page)).toContainText("After this song");

  // Let the song run out: jump it to ~20 s before its end (paused, Page Up moves 8 bars ≈ 15 s), play on, wait.
  await deck(page, "B").getByRole("button", { name: "Pause Deck B" }).click();
  await expect.poll(() => states(page)).toMatch(/B:Paused/);
  const left = (await deckStates(page)).find((d) => d.startsWith("B:"))!.match(/−(\d+):(\d\d)/)!;
  const remaining = Number(left[1]) * 60 + Number(left[2]);
  const jog = page.getByRole("slider", { name: "Song position, Deck B" });
  await jog.focus();
  for (let i = 0; i < Math.max(0, Math.floor((remaining - 20) / 15.2)); i++) await jog.press("PageUp");
  await page.waitForTimeout(600);
  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  // Nothing mixes before the end: B plays down to its last seconds, still alone.
  await expect.poll(async () => (await deckStates(page)).find((d) => d.startsWith("B:"))!, { timeout: 40_000 }).toMatch(/−0:0[0-3]/);
  expect(await states(page)).toMatch(/A:Cued.*B:On air/);
  // Then the next song starts on Deck A, and AI DJ is still off.
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/A:On air/);
  await expect(ai).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(/AI DJ is back on/)).toHaveCount(0);
});

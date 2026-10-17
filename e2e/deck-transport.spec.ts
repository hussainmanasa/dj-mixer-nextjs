import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary, startBooth, tapAudio } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const states = async (page: Page) => (await deckStates(page)).join(" ");
/** "A:On air 0:12 / −3:40 Test Groove C" → seconds played. */
const played = (state: string) => {
  const m = state.match(/(\d+):(\d\d) \//);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const deckA = async (page: Page) => (await deckStates(page)).find((d) => d.startsWith("A:"))!;

test("pause the song on air: silence, no recovery, then resume from the same spot or play the cued song", async ({ page }) => {
  const taps = await tapAudio(page);
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await page.waitForTimeout(3000);

  // ⏸ on Deck A: the club hears nothing, the booth says so, Drop and effects wait.
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Paused" })).toBeVisible();
  await expect.poll(() => states(page)).toMatch(/A:Paused/);
  await expect(dropButton(page)).toBeDisabled();
  await page.waitForTimeout(300);
  const at = played(await deckA(page));
  await taps.reset();
  // Longer than the silence watchdog's 2 s: it must not "recover".
  await page.waitForTimeout(4000);
  const quiet = await taps.get();
  expect(quiet.pre).toBeLessThan(0.001);
  expect(await states(page)).toMatch(/A:Paused.*B:Cued/);
  expect(played(await deckA(page))).toBe(at);

  // ▶ Play: the same song carries on from where it stopped.
  await deck(page, "A").getByRole("button", { name: "Play Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:On air/);
  await expect(page.getByRole("status").filter({ hasText: "Paused" })).toHaveCount(0);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  const resumed = played(await deckA(page));
  expect(resumed).toBeGreaterThanOrEqual(at);
  expect(resumed).toBeLessThanOrEqual(at + 3);
  // The cued song comes in again — after this song: staff paused it, so the auto-DJ doesn't mix out of it.
  await expect(page.getByText("After this song")).toBeVisible();

  // Paused again, ▶ Play on the cued deck plays that song at once — the paused one stays on Deck A, paused.
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:Paused/);
  const onA = (await deckStates(page)).find((d) => d.startsWith("A:"))!.split(" ").at(-1);
  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(new RegExp(`A:Paused .*${onA}.*B:Playing along`));
  await expect(page.getByRole("status").filter({ hasText: "Paused" })).toHaveCount(0);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  // Nothing changes by itself while Deck A is paused; Drop mixes: B takes over.
  await page.waitForTimeout(3000);
  expect(await states(page)).toMatch(new RegExp(`A:Paused .*${onA}.*B:Playing along`));
  await dropButton(page).click();
  await expect.poll(() => states(page), { timeout: 20_000 }).toMatch(/B:On air/);
});

test("both decks play: ▶ on the cued deck plays it at once; ⏸ on either deck pauses just that deck and changes nothing else", async ({ page }) => {
  const taps = await tapAudio(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  const songA = (await deckStates(page)).find((d) => d.startsWith("A:"))!.split(" ").at(-1);
  const songB = (await deckStates(page)).find((d) => d.startsWith("B:"))!.split(" ").at(-1);

  // ▶ Play: Deck B plays at once (on the next beat), together with Deck A.
  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:On air.*B:Playing along/);

  // ⏸ Deck B: it stops where it is; Deck A plays on; nothing swaps.
  await deck(page, "B").getByRole("button", { name: "Pause Deck B" }).click();
  await expect.poll(() => states(page)).toMatch(new RegExp(`A:On air .*${songA}.*B:Paused .*${songB}`));
  await taps.reset();
  await page.waitForTimeout(4000);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  expect(await states(page)).toMatch(new RegExp(`A:On air .*${songA}.*B:Paused .*${songB}`));

  // ▶ Play Deck B: back in, in time with Deck A.
  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:On air.*B:Playing along/);

  // ⏸ Deck A: it stops where it is; Deck B plays on; Deck A keeps its song.
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(new RegExp(`A:Paused .*${songA}.*B:Playing along .*${songB}`));
  await taps.reset();
  await page.waitForTimeout(4000);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  expect(await states(page)).toMatch(new RegExp(`A:Paused .*${songA}.*B:Playing along .*${songB}`));

  // ▶ Play Deck A: both play again. Drop mixes: B takes over.
  await deck(page, "A").getByRole("button", { name: "Play Deck A" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:On air.*B:Playing along/);
  await dropButton(page).click();
  await expect.poll(() => states(page), { timeout: 20_000 }).toMatch(/B:On air/);
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/A:Cued/);
  expect(errors).toEqual([]);
});

test("while paused: a mood change re-cues without sound, and Stop still stops", async ({ page }) => {
  const taps = await tapAudio(page);
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:Paused/);

  // A new mood: the next song is chosen again, but nothing plays until ▶.
  await page.getByRole("button", { name: /^Peak Hour/ }).click();
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/A:Paused.*B:Cued/);
  await expect(page.getByText("When you press ▶")).toBeVisible();
  await taps.reset();
  await page.waitForTimeout(2500);
  expect((await taps.get()).pre).toBeLessThan(0.001);

  // Stop ends the set as usual.
  await page.locator("button[aria-busy]").click();
  await expect(page.locator("button[aria-busy]")).toHaveText(/Play/, { timeout: 10_000 });
  await expect(page.getByRole("status").filter({ hasText: "Paused" })).toHaveCount(0);
});

test("a reload while paused doesn't start the music by itself", async ({ page }) => {
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air/);
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:Paused/);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator("button[aria-busy]")).toHaveText(/Play/);
  await expect(page.getByText("The last set was interrupted")).toHaveCount(0);
});

test("the Paused message can be closed; it comes back the next time the music stops", async ({ page }) => {
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air/);
  const banner = page.getByRole("status").filter({ hasText: "The club hears nothing" });
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Close the Paused message" }).click();
  await expect(banner).toHaveCount(0);
  await page.waitForTimeout(1000);
  await expect(banner).toHaveCount(0);
  expect(await states(page)).toMatch(/A:Paused/);
  // Play, then pause again: it shows again.
  await deck(page, "A").getByRole("button", { name: "Play Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:On air/);
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect(banner).toBeVisible();
});

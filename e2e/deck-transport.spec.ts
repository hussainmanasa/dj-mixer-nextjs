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

  // ▶ Resume: the same song carries on from where it stopped.
  await deck(page, "A").getByRole("button", { name: "Resume Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:On air/);
  await expect(page.getByRole("status").filter({ hasText: "Paused" })).toHaveCount(0);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  const resumed = played(await deckA(page));
  expect(resumed).toBeGreaterThanOrEqual(at);
  expect(resumed).toBeLessThanOrEqual(at + 3);
  // The auto-DJ plans the next mix again.
  await expect(page.getByText(/Beat-matched blend|Filter sweep|Echo-out|Cut on|Drop\b/).first()).toBeVisible();

  // Paused again, ▶ Play now on the cued deck starts that song at once; the paused one is done.
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:Paused/);
  const cued = (await deckStates(page)).find((d) => d.startsWith("B:"))!.split(" ").at(-1);
  await deck(page, "B").getByRole("button", { name: "Play Deck B now" }).click();
  await expect.poll(() => states(page)).toMatch(new RegExp(`B:On air .*${cued}`));
  await expect(page.getByRole("status").filter({ hasText: "Paused" })).toHaveCount(0);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  // And a new song gets cued on the free deck.
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/A:Cued/);
});

test("▶ on the cued deck mixes it in now; ⏸ during a mix stops that side and the other song carries on", async ({ page }) => {
  const taps = await tapAudio(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);

  // ▶ Play now on the cued deck: it comes in on the next phrase instead of at the planned mix point.
  await deck(page, "B").getByRole("button", { name: "Play Deck B now" }).click();
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/B:Mixing in/);

  // ⏸ on the incoming deck mid-mix: it stops, Deck A carries on alone at full level.
  await deck(page, "B").getByRole("button", { name: "Pause Deck B" }).click();
  await expect.poll(() => states(page)).toMatch(/A:On air.*B:Cued/);
  await expect(page.getByText(/paused — it comes in near the end of this song/)).toBeVisible();
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);

  // Bring it in again, then ⏸ on the outgoing deck mid-mix: Deck B carries on alone.
  await deck(page, "B").getByRole("button", { name: "Play Deck B now" }).click();
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/B:Mixing in/);
  const incoming = (await deckStates(page)).find((d) => d.startsWith("B:"))!.split(" ").at(-1);
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page), { timeout: 5000 }).toMatch(new RegExp(`B:On air .*${incoming}`));
  await expect(page.getByText(/stopped — .* carries on/)).toBeVisible();
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  // The auto-DJ carries on: the next song is cued on Deck A.
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

import { expect, test, type Locator, type Page } from "@playwright/test";
import { deckStates, loadLibrary, startBooth, tapAudio } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const states = async (page: Page) => (await deckStates(page)).join(" ");
/** Seconds played on Deck A, from its "0:12 / −3:40" read-out. */
const playedA = async (page: Page) => {
  const m = (await deckStates(page)).find((d) => d.startsWith("A:"))!.match(/(\d+):(\d\d) \//);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Turn the wheel `turns` times (negative = backwards), holding it until `release`. */
async function spin(page: Page, jog: Locator, turns: number, release = true) {
  await jog.scrollIntoViewIfNeeded();
  const box = (await jog.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.width * 0.35;
  await page.mouse.move(cx, cy - r);
  await page.mouse.down();
  const steps = Math.round(Math.abs(turns) * 24);
  for (let i = 1; i <= steps; i++) {
    const t = Math.sign(turns) * ((2 * Math.PI) / 24) * i;
    await page.mouse.move(cx + r * Math.sin(t), cy - r * Math.cos(t));
    await page.waitForTimeout(25);
  }
  if (release) await page.mouse.up();
}

test("the jog wheel on the song on air: hold and scratch it, let go and it plays on; on a paused song it moves the spot", async ({ page }) => {
  const taps = await tapAudio(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air/);
  const jog = page.getByRole("slider", { name: "Song position, Deck A" });
  await expect(jog).toBeVisible();
  await expect.poll(() => playedA(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(9);

  // Playing: grab it and turn it back 3 times (≈ 5.4 s of audio). It's heard as a scratch, not as a pause.
  const before = await playedA(page);
  await spin(page, jog, -3, false);
  await expect.poll(() => states(page)).toMatch(/A:Scratch/);
  await expect(page.getByRole("status").filter({ hasText: "Paused" })).toHaveCount(0);
  await expect.poll(async () => (await taps.get()).scrubPeak).toBeGreaterThan(0.01);
  await page.mouse.up();
  // Let go: it plays on from where the hand left it.
  await expect.poll(() => states(page)).toMatch(/A:On air/);
  const after = await playedA(page);
  expect(after).toBeLessThanOrEqual(before - 2);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);

  // A key step jumps a beat and plays on.
  await jog.focus();
  await jog.press("ArrowRight");
  await expect.poll(() => states(page), { timeout: 5000 }).toMatch(/A:On air/);
  await page.waitForTimeout(800);
  await taps.reset();
  await page.waitForTimeout(1000);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);

  // Paused: the wheel moves the paused spot (2 turns ≈ 3.6 s on), it stays paused, ▶ plays from there.
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:Paused/);
  await page.waitForTimeout(300);
  const pausedAt = await playedA(page);
  await spin(page, page.getByRole("slider", { name: "Song position, Deck A" }), 2);
  await page.waitForTimeout(300);
  expect(await states(page)).toMatch(/A:Paused/);
  await expect(page.getByRole("status").filter({ hasText: "Paused" })).toBeVisible();
  const moved = await playedA(page);
  expect(moved).toBeGreaterThanOrEqual(pausedAt + 3);
  expect(moved).toBeLessThanOrEqual(pausedAt + 5);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeLessThan(0.001);
  await deck(page, "A").getByRole("button", { name: "Play Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:On air/);
  expect(await playedA(page)).toBeGreaterThanOrEqual(moved);
  expect(errors).toEqual([]);
});

test("with both decks playing together, the jog wheel works on both", async ({ page }) => {
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/B:Playing along/);
  await expect(page.getByRole("slider", { name: "Song position, Deck A" })).toHaveCount(1);
  // Deck B's wheel holds and moves its song too: held, it stops (Scratch); let go, it plays on.
  const jogB = page.getByRole("slider", { name: "Song position, Deck B" });
  await expect(jogB).toHaveCount(1);
  await page.waitForTimeout(1500);
  const before = (await deckStates(page)).find((d) => d.startsWith("B:"))!;
  await spin(page, jogB, 2, false);
  expect(await states(page)).toMatch(/A:On air.*B:Scratch/);
  await page.mouse.up();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:On air.*B:Playing along/);
  expect((await deckStates(page)).find((d) => d.startsWith("B:"))).not.toBe(before);
});

test("the track view follows the jog wheel while it turns, not only when it's let go", async ({ page }) => {
  await loadLibrary(page);
  /** The track view row's "m:ss / −m:ss" for a deck, in seconds. */
  const rowTime = async (letter: string) => {
    const t = (await page.getByRole("group", { name: `Track view, Deck ${letter}` }).textContent()) ?? "";
    const m = t.match(/(\d+):(\d\d) \/ −/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };

  // Before Play: a loaded deck's start point, turned forwards 3 times (≈ 5.4 s), shows in the track view mid-turn.
  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: "Load track, Deck A" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove A" }).getByRole("button").last().click();
  await expect.poll(() => rowTime("A")).not.toBeNaN();
  const before = await rowTime("A");
  await spin(page, page.getByRole("slider", { name: "Start point, Deck A" }), 3, false);
  await expect.poll(() => rowTime("A"), { timeout: 2000 }).toBeGreaterThanOrEqual(before + 4);
  await page.mouse.up();
  await page.getByRole("button", { name: "Eject Deck A" }).click();

  // During the set: hold the song on air and turn it back twice (≈ 3.6 s) — the track view goes back while held.
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air/);
  await expect.poll(() => rowTime("A"), { timeout: 20_000 }).toBeGreaterThanOrEqual(8);
  const held = await rowTime("A");
  await spin(page, page.getByRole("slider", { name: "Song position, Deck A" }), -2, false);
  expect(await states(page)).toMatch(/A:Scratch/);
  await expect.poll(() => rowTime("A"), { timeout: 2000 }).toBeLessThanOrEqual(held - 2);
  await page.mouse.up();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/A:On air/);
});

import { expect, test, type Page } from "@playwright/test";
import { deckStates, loadLibrary, startBooth, tapAudio } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const states = async (page: Page) => (await deckStates(page)).join(" ");
const playedA = async (page: Page) => {
  const m = (await deckStates(page)).find((d) => d.startsWith("A:"))!.match(/(\d+):(\d\d) \//);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const bpmOf = async (page: Page, letter: string) => Number(await deck(page, letter).getByText(/^\d+\.\d$/).first().textContent());

test("Sync sets one deck's BPM to the other's", async ({ page }) => {
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  const a = await bpmOf(page, "A");

  // Sync on the song on air: it takes the cued song's BPM.
  // The fixture songs carry their own BPM in the title, e.g. "Test Groove C 127".
  const cuedBpm = Number((await deck(page, "B").getByText(/^Test Groove [A-D] \d+$/).textContent())!.split(" ").at(-1));
  await page.getByRole("button", { name: "Sync Deck A" }).click();
  await expect.poll(() => bpmOf(page, "A")).toBeCloseTo(cuedBpm, 0);
  await expect(page.getByRole("button", { name: "Sync Deck A" })).toHaveAttribute("data-on", "true");

  // Back to its own tempo, then Sync on the cued song: it takes the song on air's BPM (after its mix).
  await page.getByRole("button", { name: "Reset tempo, Deck A" }).click();
  await expect.poll(() => bpmOf(page, "A")).toBeCloseTo(a, 1);
  await page.getByRole("button", { name: "Sync Deck B" }).click();
  await expect(page.getByRole("button", { name: "Sync Deck B" })).toHaveAttribute("data-on", "true");
  const expected = ((a / cuedBpm - 1) * 100).toFixed(1);
  await expect(page.getByRole("button", { name: "Reset tempo, Deck B" })).toHaveText(`${Number(expected) > 0 ? "+" : ""}${expected}%`);
});

test("cue pads: save the spot, jump back to it on the beat, clear it; on the cued deck a pad sets the start", async ({ page }) => {
  const taps = await tapAudio(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await expect.poll(() => playedA(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(3);

  // An empty pad saves where the song is.
  const saved = await playedA(page);
  await page.getByRole("button", { name: "Save cue A, Deck A" }).click();
  const padA = deck(page, "A").getByRole("button", { name: /^Cue A, Bar \d+\.\d, Deck A$/ });
  await expect(padA).toBeVisible();
  await expect.poll(() => playedA(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(saved + 5);

  // Pressing it jumps back there (on the next beat) and the music plays on.
  await padA.click();
  await expect.poll(() => playedA(page)).toBeLessThanOrEqual(saved + 2);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  expect(await states(page)).toMatch(/A:On air.*B:Cued/);
  // The overview marks it.
  await expect(deck(page, "A").getByText("A", { exact: true }).last()).toBeAttached();

  // Shift-click empties a pad; so does Clear, then a tap.
  await padA.click({ modifiers: ["Shift"] });
  await expect(page.getByRole("button", { name: "Save cue A, Deck A" })).toBeVisible();
  await page.getByRole("button", { name: "Save cue B, Deck A" }).click();
  await deck(page, "A").getByRole("button", { name: "Clear" }).click();
  await deck(page, "A").getByRole("button", { name: /^Cue B, / }).click();
  await expect(page.getByRole("button", { name: "Save cue B, Deck A" })).toBeVisible();

  // On the cued deck: save its start on pad A, choose Drop, then pad A brings the start back as a bar.
  await page.getByRole("button", { name: "Save cue A, Deck B" }).click();
  const padB = deck(page, "B").getByRole("button", { name: /^Cue A, Bar \d+\.\d, Deck B$/ });
  await expect(padB).toBeVisible();
  const bar = (await padB.getAttribute("aria-label"))!.match(/Bar \d+\.\d/)![0];
  await deck(page, "B").getByRole("radio", { name: "Drop" }).click();
  await padB.click();
  await expect(deck(page, "B").getByText(bar, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("while paused the jog wheel scratches on the club speakers and moves the spot; the song stays paused", async ({ page }) => {
  const taps = await tapAudio(page);
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air/);
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:Paused/);
  await page.waitForTimeout(300);
  const before = await playedA(page);
  const messages = (await taps.get()).scrubMessages.length;

  const jog = page.getByRole("slider", { name: "Song position, Deck A" });
  const box = (await jog.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.width * 0.35;
  await taps.reset();
  await page.mouse.move(cx, cy - r);
  await page.mouse.down();
  for (let i = 1; i <= 48; i++) {
    const t = ((2 * Math.PI) / 24) * i;
    await page.mouse.move(cx + r * Math.sin(t), cy - r * Math.cos(t));
    await page.waitForTimeout(25);
  }
  // The scratch is heard (on the mix's engine, so on the club speakers) while turning.
  const turning = await taps.get();
  expect(turning.scrubMessages.length).toBeGreaterThan(messages);
  expect(turning.scrubPeak).toBeGreaterThan(0.01);
  expect(turning.scrubHint).toBe("playback");
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await playedA(page)).toBeGreaterThanOrEqual(before + 3);
  // Let go: the scratch dies away and the song stays paused, silent.
  await page.waitForTimeout(500);
  await taps.reset();
  await page.waitForTimeout(1000);
  expect((await taps.get()).pre).toBeLessThan(0.001);
  expect(await states(page)).toMatch(/A:Paused/);
});

import { expect, test, type Page } from "@playwright/test";
import { deckStates, loadLibrary, startBooth } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const states = async (page: Page) => (await deckStates(page)).join(" ");
const played = async (page: Page, letter: string) => {
  const m = (await deckStates(page)).find((d) => d.startsWith(`${letter}:`))!.match(/(\d+):(\d\d) \//);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
/** An element's offset from its parent's left / bottom edge, as a share of the parent (0..1). */
const along = (page: Page, testId: string, edge: "left" | "bottom") =>
  page.getByTestId(testId).evaluate((el, edge) => {
    const r = el.getBoundingClientRect();
    const p = el.parentElement!.getBoundingClientRect();
    return edge === "left" ? (r.left - p.left) / p.width : (p.bottom - r.bottom) / p.height;
  }, edge);

test("the booth is laid out like a DDJ-FLX4: Deck A · mixer · Deck B, with the deck and mixer controls in their places", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loadLibrary(page);
  await page.click("nav >> text=Booth");
  const mixer = page.getByRole("region", { name: "Mixer" });
  const [a, m, b] = await Promise.all([deck(page, "A").boundingBox(), mixer.boundingBox(), deck(page, "B").boundingBox()]);
  expect(a!.x + a!.width).toBeLessThanOrEqual(m!.x);
  expect(m!.x + m!.width).toBeLessThanOrEqual(b!.x);
  expect(Math.abs(a!.y - m!.y)).toBeLessThan(2);
  // The mixer: the two volumes, the set's Play, LOAD per deck, AI DJ, Drop, beat FX, 🎧 CUE per channel.
  await expect(mixer.getByRole("slider", { name: "Club speakers volume" })).toHaveCount(1);
  await expect(mixer.getByRole("slider", { name: "Headphones volume" })).toHaveCount(1);
  await expect(mixer.locator("button[aria-busy]")).toHaveCount(1);
  await expect(mixer.getByRole("button", { name: "Load track, Deck A" })).toBeEnabled();
  await expect(mixer.getByRole("button", { name: "Load track, Deck B" })).toBeEnabled();
  await expect(mixer.getByRole("switch", { name: "AI DJ" })).toHaveCount(1);
  await expect(mixer.getByRole("button", { name: "Filter", exact: true })).toHaveCount(1);
  await expect(mixer.getByRole("button", { name: "Listen, Deck A" })).toHaveCount(1);
  // Each deck: the loop section and BEAT SYNC on top, the jog with the tempo slider, CUE / Play and the pads below.
  for (const l of ["A", "B"]) {
    const d = deck(page, l);
    const loop = await d.getByRole("group", { name: `Loop, Deck ${l}` }).boundingBox();
    const jog = await d.getByRole("slider", { name: `Tempo, Deck ${l}` }).boundingBox();
    const pads = await d.getByRole("group", { name: `Cue pads, Deck ${l}` }).boundingBox();
    const cue = await d.getByRole("button", { name: `Cue Deck ${l}` }).boundingBox();
    expect(loop!.y).toBeLessThan(jog!.y);
    expect(jog!.y + jog!.height).toBeLessThanOrEqual(pads!.y);
    expect(cue!.x).toBeLessThan(pads!.x);
    await expect(d.getByRole("button", { name: `Sync Deck ${l}` })).toHaveCount(1);
  }

  // The master knob turns with the keyboard and a drag (up = louder).
  const master = mixer.getByRole("slider", { name: "Club speakers volume" });
  const start = Number(await master.inputValue());
  await master.focus();
  await page.keyboard.press("ArrowDown");
  await expect(master).toHaveValue(String(start - 1));
  await master.scrollIntoViewIfNeeded();
  const box = (await master.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  expect(Number(await master.inputValue())).toBeLessThan(start - 10);
  await master.fill(String(start));
});

test("the mixer shows what the auto-DJ does, and the loop section works: IN / OUT, 4 BEAT, ½ and 2×", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await page.waitForTimeout(1000);
  // Only Deck A is up: its channel fader is at the top, Deck B's down, the crossfader to the left.
  expect(await along(page, "fader-1", "bottom")).toBeGreaterThan(0.7);
  expect(await along(page, "fader-2", "bottom")).toBeLessThan(0.1);
  expect(await along(page, "crossfader", "left")).toBeLessThan(0.1);
  // ▶ on Deck B: both play at full, both faders up, the crossfader in the middle.
  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/B:Playing along/);
  await expect.poll(() => along(page, "fader-2", "bottom")).toBeGreaterThan(0.7);
  await expect.poll(() => along(page, "crossfader", "left")).toBeGreaterThan(0.3);
  expect(await along(page, "crossfader", "left")).toBeLessThan(0.55);

  // 4 BEAT on Deck A, then ½ and 2× (shown on the BEAT LOOP pads), then EXIT.
  const a = deck(page, "A");
  await a.getByRole("button", { name: "Beat loop pads, Deck A" }).click();
  await a.getByRole("button", { name: "4-beat loop, Deck A" }).click();
  await expect(a.getByRole("button", { name: "Loop 4 beats, Deck A" })).toHaveAttribute("aria-pressed", "true");
  await a.getByRole("button", { name: "Halve loop, Deck A" }).click();
  await expect(a.getByRole("button", { name: "Loop 2 beats, Deck A" })).toHaveAttribute("aria-pressed", "true");
  await a.getByRole("button", { name: "Double loop, Deck A" }).click();
  await a.getByRole("button", { name: "Double loop, Deck A" }).click();
  await expect(a.getByRole("button", { name: "Loop 8 beats, Deck A" })).toHaveAttribute("aria-pressed", "true");
  await a.getByRole("button", { name: "Exit loop, Deck A" }).click();
  await expect(a.getByRole("button", { name: "4-beat loop, Deck A" })).toBeVisible();

  // IN, about 2 s later OUT: the song loops between them (its time stays put).
  await a.getByRole("button", { name: "Loop in, Deck A" }).click();
  await expect(a.getByRole("button", { name: "Loop in, Deck A" })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(2000);
  await a.getByRole("button", { name: "Loop out, Deck A" }).click();
  await expect(a.getByRole("button", { name: "Exit loop, Deck A" })).toBeVisible();
  const at = await played(page, "A");
  await page.waitForTimeout(5000);
  expect(await played(page, "A")).toBeLessThanOrEqual(at + 3);
  await a.getByRole("button", { name: "Exit loop, Deck A" }).click();
  await expect.poll(() => played(page, "A"), { timeout: 8000 }).toBeGreaterThanOrEqual(at + 4);
  expect(errors).toEqual([]);
});

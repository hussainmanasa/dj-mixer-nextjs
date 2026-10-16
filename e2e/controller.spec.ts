import { expect, test, type Page } from "@playwright/test";
import { deckStates, loadLibrary, startBooth, tapAudio } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const states = async (page: Page) => (await deckStates(page)).join(" ");
const played = async (page: Page, letter: string) => {
  const m = (await deckStates(page)).find((d) => d.startsWith(`${letter}:`))!.match(/(\d+):(\d\d) \//);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
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

test("the loop section works: 4 BEAT, ½ and 2×, IN / OUT", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await page.waitForTimeout(1000);

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

test("every mixer control works: channel faders, crossfader, TRIM, EQ and CFX change what the club hears", async ({ page }) => {
  const taps = await tapAudio(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  const mixer = page.getByRole("region", { name: "Mixer" });
  /** The mix's peak level over 1.5 s (after the meter's ~0.7 s window has caught up). */
  const level = async () => {
    await page.waitForTimeout(900);
    await taps.reset();
    await page.waitForTimeout(1500);
    return (await taps.get()).pre;
  };
  const control = (name: string) => mixer.getByRole("slider", { name, exact: true });
  const base = await level();
  expect(base).toBeGreaterThan(0.05);

  // Channel fader down: Deck A goes silent — on purpose, so the auto-DJ doesn't "recover" — and the mixer says so.
  await control("Channel fader, Deck A").fill("0");
  expect(await level()).toBeLessThan(0.002);
  await expect(mixer.getByText("Deck A turned down — the club doesn't hear it")).toBeVisible();
  await page.waitForTimeout(3000);
  expect(await states(page)).toMatch(/A:On air .*Test Groove/);
  await expect(page.getByText(/Recovered automatically/)).toHaveCount(0);
  await control("Channel fader, Deck A").fill("100");
  expect(await level()).toBeGreaterThan(base * 0.7);

  // Crossfader all the way to Deck B: Deck A is cut; the centre brings it back at full.
  await control("Crossfader").fill("100");
  expect(await level()).toBeLessThan(0.002);
  await control("Crossfader").fill("50");
  expect(await level()).toBeGreaterThan(base * 0.7);

  // TRIM fully down (−12 dB), then back to the centre.
  await control("Trim, Deck A").fill("-100");
  expect(await level()).toBeLessThan(base * 0.5);
  await control("Trim, Deck A").fill("0");
  expect(await level()).toBeGreaterThan(base * 0.7);

  // LOW killed: the kick-heavy test songs lose most of their level.
  await control("Low, Deck A").fill("-100");
  expect(await level()).toBeLessThan(base * 0.7);
  await control("Low, Deck A").locator("..").dblclick();
  await expect(control("Low, Deck A")).toHaveValue("0");

  // CFX to the right: the high-pass takes the bass out.
  await control("CFX, Deck A").fill("100");
  expect(await level()).toBeLessThan(base * 0.6);
  await control("CFX, Deck A").fill("0");
  expect(await level()).toBeGreaterThan(base * 0.7);

  // HI and MID turn too (keys), and say how far.
  const hi = control("Hi, Deck A");
  await hi.focus();
  await page.keyboard.press("ArrowRight");
  await expect(hi).toHaveValue("1");
  await expect(hi).toHaveAttribute("aria-valuetext", /\+0\.1 dB/);
  await control("Mid, Deck A").fill("-50");
  await expect(control("Mid, Deck A")).toHaveAttribute("aria-valuetext", "-13.0 dB");
  // Dragging a channel fader moves it too.
  const fader = control("Channel fader, Deck B");
  await fader.scrollIntoViewIfNeeded();
  const box = (await fader.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.up();
  expect(Number(await fader.inputValue())).toBeLessThan(10);
  expect(errors).toEqual([]);
});

test("scrolling over a control turns it and never scrolls the page (trackpad swipes too)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air/);
  const mixer = page.getByRole("region", { name: "Mixer" });
  const scrollY = () => page.evaluate(() => window.scrollY);
  /** Swipe over a control like a trackpad (many small pixel steps), and say what its value did and whether the page moved. */
  const swipe = async (control: ReturnType<Page["locator"]>, over: ReturnType<Page["locator"]>, dx: number, dy: number) => {
    await over.scrollIntoViewIfNeeded();
    const box = (await over.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const y0 = await scrollY();
    const v0 = Number(await control.inputValue());
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(dx / 6, dy / 6);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(300);
    return { moved: Number(await control.inputValue()) - v0, scrolled: (await scrollY()) - y0 };
  };

  const master = mixer.getByRole("slider", { name: "Club speakers volume" });
  // Two fingers down over the MASTER knob: it turns down, the page stays put.
  let r = await swipe(master, master.locator(".."), 0, 48);
  expect(r.scrolled).toBe(0);
  expect(r.moved).toBeLessThan(-15);
  r = await swipe(master, master.locator(".."), 0, -48);
  expect(r.scrolled).toBe(0);
  expect(r.moved).toBeGreaterThan(15);

  // A channel fader (down), the crossfader (sideways) and Deck A's tempo slider (up).
  const fader = mixer.getByRole("slider", { name: "Channel fader, Deck A" });
  r = await swipe(fader, fader.locator(".."), 0, 48);
  expect(r).toMatchObject({ scrolled: 0 });
  expect(r.moved).toBeLessThan(-15);
  const xfader = mixer.getByRole("slider", { name: "Crossfader" });
  r = await swipe(xfader, xfader.locator(".."), 48, 0);
  expect(r.scrolled).toBe(0);
  expect(r.moved).toBeGreaterThan(15);
  await xfader.fill("50");
  const tempo = deck(page, "A").getByRole("slider", { name: "Tempo, Deck A" });
  r = await swipe(tempo, tempo, 0, -48);
  expect(r.scrolled).toBe(0);
  expect(r.moved).toBeGreaterThan(1);

  // Over the pads (buttons), the page still scrolls as usual.
  const pads = deck(page, "A").getByRole("group", { name: "Cue pads, Deck A" });
  await pads.scrollIntoViewIfNeeded();
  const box = (await pads.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const y0 = await scrollY();
  await page.mouse.wheel(0, -200);
  await expect.poll(scrollY).toBeLessThan(y0);
});

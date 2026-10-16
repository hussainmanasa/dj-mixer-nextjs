import { expect, test, type Locator, type Page } from "@playwright/test";
import { deckStates, loadLibrary, startBooth } from "./helpers";

const states = async (page: Page) => (await deckStates(page)).join(" ");
const playedA = async (page: Page) => {
  const m = (await deckStates(page)).find((d) => d.startsWith("A:"))!.match(/(\d+):(\d\d) \//);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** A trackpad two-finger swipe over the wheel: `events` scroll events of `px` each, `ms` apart. */
const swipe = (jog: Locator, px: number, events: number, ms: number) =>
  jog.evaluate(
    async (el, { px, events, ms }) => {
      const box = el.getBoundingClientRect();
      for (let i = 0; i < events; i++) {
        el.dispatchEvent(
          new WheelEvent("wheel", { deltaY: px, deltaMode: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true, cancelable: true }),
        );
        await new Promise((r) => setTimeout(r, ms));
      }
    },
    { px, events, ms },
  );

/** Two fingers on the wheel, twisting it by `turns` (negative = back) in `steps` moves `ms` apart, then lifted. */
const twist = (jog: Locator, turns: number, steps: number, ms: number) =>
  jog.evaluate(
    async (el, { turns, steps, ms }) => {
      const box = el.getBoundingClientRect();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const r = box.width * 0.3;
      const at = (id: number, a: number) => ({ pointerId: id, pointerType: "touch", clientX: cx + r * Math.cos(a), clientY: cy + r * Math.sin(a), bubbles: true });
      const fire = (type: string, id: number, a: number) => el.dispatchEvent(new PointerEvent(type, at(id, a)));
      fire("pointerdown", 21, 0);
      fire("pointerdown", 22, Math.PI);
      for (let i = 1; i <= steps; i++) {
        const a = (turns * 2 * Math.PI * i) / steps;
        fire("pointermove", 21, a);
        fire("pointermove", 22, a + Math.PI);
        await new Promise((res) => setTimeout(res, ms));
      }
      const end = turns * 2 * Math.PI;
      fire("pointerup", 22, end + Math.PI);
      fire("pointerup", 21, end);
    },
    { turns, steps, ms },
  );

test("trackpad: a two-finger swipe scratches the song on air, a fast swipe back spins it back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await expect.poll(() => playedA(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(8);
  const jog = page.getByRole("slider", { name: "Song position, Deck A" });

  // Slow swipe down (back) over 2 turns ≈ 3.6 s of audio: a scratch, then it plays on from there.
  const before = await playedA(page);
  const slow = swipe(jog, -8, 150, 16);
  await expect.poll(() => states(page)).toMatch(/A:Scratch/);
  await slow;
  await expect.poll(() => states(page)).toMatch(/A:On air/);
  expect(await playedA(page)).toBeLessThanOrEqual(before - 1);
  expect(await states(page)).toMatch(/B:Cued/);

  // A fast swipe back (real trackpad events): spinback, and the cued song drops in. The page never scrolls — not
  // during the swipe, nor from its momentum once Deck A's song has gone.
  const cued = (await deckStates(page)).find((d) => d.startsWith("B:"))!.split(" ").at(-1);
  await jog.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  const box = (await jog.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const y0 = await page.evaluate(() => window.scrollY);
  expect(y0).toBeGreaterThan(0);
  for (let i = 0; i < 15; i++) await page.mouse.wheel(0, -60);
  await expect.poll(() => states(page), { timeout: 5000 }).toMatch(new RegExp(`B:On air .*${cued}`));
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, -Math.max(2, 40 - i));
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(y0);
  expect(errors).toEqual([]);
});

test("touchscreen: twisting the wheel with two fingers scratches; a fast twist back, let go, spins back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await expect.poll(() => playedA(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(8);
  const jog = page.getByRole("slider", { name: "Song position, Deck A" });

  const before = await playedA(page);
  await twist(jog, -2, 96, 16);
  await expect.poll(() => states(page)).toMatch(/A:On air/);
  expect(await playedA(page)).toBeLessThanOrEqual(before - 1);

  const cued = (await deckStates(page)).find((d) => d.startsWith("B:"))!.split(" ").at(-1);
  await twist(jog, -1.5, 36, 4);
  await expect.poll(() => states(page), { timeout: 5000 }).toMatch(new RegExp(`B:On air .*${cued}`));
  expect(errors).toEqual([]);
});

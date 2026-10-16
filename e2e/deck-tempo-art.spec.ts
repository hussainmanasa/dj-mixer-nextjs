import { expect, test, type Page } from "@playwright/test";
import { ART_DIR, makeArtFixture } from "./art-fixture";
import { FIXTURE_DIR } from "./fixtures";
import { deckStates, loadLibrary, startBooth, tapAudio } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const states = async (page: Page) => (await deckStates(page)).join(" ");

test("tempo sliders: the song on air changes tempo at once and resets; the cued song keeps its tempo for after its mix", async ({ page }) => {
  const taps = await tapAudio(page);
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  const bpmA = Number((await deck(page, "A").getByText(/^\d+\.\d$/).first().textContent()) ?? 0);

  // +4% on the song on air: its BPM goes up at once, and the music plays on.
  await page.getByRole("slider", { name: "Tempo, Deck A" }).fill("4");
  await expect(deck(page, "A")).toContainText((bpmA * 1.04).toFixed(1));
  await expect(deck(page, "A")).toContainText("tempo +4.0%");
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  // The auto-DJ re-times the next mix for the new tempo.
  await expect(page.getByText(/Beat-matched blend|Filter sweep|Echo-out|Cut on|Drop\b/).first()).toBeVisible();
  await expect.poll(() => states(page)).toMatch(/A:On air.*B:Cued/);

  // Back to its own tempo.
  await page.getByRole("button", { name: "Reset tempo, Deck A" }).click();
  await expect(deck(page, "A")).toContainText(bpmA.toFixed(1));

  // The cued song: −3% is kept for after its mix, also when its mix is re-planned.
  await page.getByRole("slider", { name: "Tempo, Deck B" }).fill("-3");
  await expect(page.getByRole("button", { name: "Reset tempo, Deck B" })).toHaveText("-3.0%");
  await deck(page, "B").getByRole("radio", { name: "Beginning" }).click();
  await page.waitForTimeout(500);
  await expect(page.getByRole("button", { name: "Reset tempo, Deck B" })).toHaveText("-3.0%");
});

test("a fast backward flick of the jog wheel spins the song back and drops the cued song in", async ({ page }) => {
  const taps = await tapAudio(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await page.waitForTimeout(4000);
  const cued = (await deckStates(page)).find((d) => d.startsWith("B:"))!.split(" ").at(-1);

  const jog = page.getByRole("slider", { name: "Song position, Deck A" });
  await jog.scrollIntoViewIfNeeded();
  const box = (await jog.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.width * 0.35;
  await page.mouse.move(cx, cy - r);
  await page.mouse.down();
  // Two quick turns backwards (~4 turns a second), released while still spinning. The moves are sent from the
  // page every 4 ms in 7.5° steps, as a hand makes them (Playwright's own moves take ~10 ms each: too slow).
  await jog.evaluate(
    async (el, { cx, cy, r }) => {
      for (let i = 1; i <= 96; i++) {
        const t = -((2 * Math.PI) / 48) * i;
        const at = { clientX: cx + r * Math.sin(t), clientY: cy - r * Math.cos(t) };
        el.dispatchEvent(new PointerEvent("pointermove", { ...at, pointerId: 1, pointerType: "mouse", bubbles: true, buttons: 1 }));
        await new Promise((done) => setTimeout(done, 4));
      }
    },
    { cx, cy, r },
  );
  await page.mouse.up();
  await expect.poll(() => states(page), { timeout: 5000 }).toMatch(new RegExp(`B:On air .*${cued}`));
  await page.waitForTimeout(1500);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);
  // The auto-DJ carries on with a new song on the free deck.
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/A:Cued/);
  expect(errors).toEqual([]);
});

test("the jog wheel shows the song's cover art (initials without one); BPM sits beside it", async ({ page }) => {
  makeArtFixture();
  await loadLibrary(page, [FIXTURE_DIR, ART_DIR]);
  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: "Load track, Deck A" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Cover Groove" }).getByRole("button").last().click();
  await page.getByRole("button", { name: "Load track, Deck B" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove A" }).getByRole("button").last().click();

  const cover = deck(page, "A").locator("img");
  await expect(cover).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(320);
  await expect(deck(page, "B").locator("img")).toHaveCount(0);
  await expect(deck(page, "B").getByText("TG", { exact: true })).toBeVisible();
  // The BPM read-out is beside the wheel now, not in its centre.
  await expect(page.getByRole("slider", { name: "Start point, Deck A" })).not.toContainText("BPM");
  await expect(deck(page, "A")).toContainText("127.0");
  await page.screenshot({ path: "test-results/art.png" });

  // During the set the art stays, and the tempo sliders appear.
  await page.locator("button[aria-busy]").click();
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air/);
  await expect(deck(page, "A").locator("img")).toHaveAttribute("src", /^blob:/);
  await expect(page.getByRole("slider", { name: "Tempo, Deck A" })).toBeVisible();
  await page.screenshot({ path: "test-results/art-playing.png" });
});

import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary, startBooth } from "./helpers";

const states = async (page: Page) => (await deckStates(page)).join(" ");
const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });

/** Where the controls are on the page (tops and heights, rounded to the pixel; scrolling doesn't count). */
async function layout(page: Page) {
  const where = (l: ReturnType<Page["locator"]>) =>
    l.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return [Math.round(r.top + window.scrollY), Math.round(r.height)];
    });
  return Promise.all([
    where(dropButton(page)),
    where(deck(page, "A").getByRole("group", { name: "Cue pads, Deck A" })),
    where(deck(page, "B").getByRole("group", { name: "Cue pads, Deck B" })),
    where(deck(page, "A").getByRole("group", { name: "Loop, Deck A" })),
    where(page.getByRole("group", { name: "Track view, Deck B" })),
    where(page.getByRole("region", { name: "Mixer" })),
  ]);
}

test("the booth doesn't jump: every control keeps its place as decks play, pause and play together", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await page.waitForTimeout(800);
  const base = await layout(page);

  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/B:Playing along/);
  await page.waitForTimeout(500);
  expect(await layout(page)).toEqual(base);

  await deck(page, "B").getByRole("button", { name: "Pause Deck B" }).click();
  await expect.poll(() => states(page)).toMatch(/B:Paused/);
  await page.waitForTimeout(300);
  expect(await layout(page)).toEqual(base);

  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:Paused.*B:Paused/);
  await page.waitForTimeout(300);
  expect(await layout(page)).toEqual(base);
  await page.screenshot({ path: "test-results/both-paused.png" });

  // Both back; Drop; the next song cued: still the same places.
  await deck(page, "A").getByRole("button", { name: "Play Deck A" }).click();
  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  await dropButton(page).click();
  await expect.poll(() => states(page), { timeout: 20_000 }).toMatch(/A:Cued.*B:On air/);
  await page.waitForTimeout(500);
  expect(await layout(page)).toEqual(base);
});

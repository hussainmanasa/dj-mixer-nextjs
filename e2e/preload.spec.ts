import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary } from "./helpers";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}
const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const seconds = (s: string) => {
  const m = /(\d+):(\d\d) \//.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

test("decks loaded before Play: Deck A starts from its chosen point, Deck B comes in next", async ({ page }) => {
  const errors = collectErrors(page);
  await loadLibrary(page);
  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: /^Groove/ }).click();

  // Load Deck A with C (start from its drop) and Deck B with A.
  await deck(page, "A").getByRole("button", { name: "Load track" }).click();
  await expect(page.getByRole("dialog")).toContainText("Load a track into Deck A");
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove C" }).getByRole("button").click();
  await expect(deck(page, "A")).toContainText("Loaded");
  await expect(deck(page, "A")).toContainText("Test Groove C");
  await deck(page, "A").getByRole("radio", { name: "Drop" }).click();
  await deck(page, "B").getByRole("button", { name: "Load track" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove A" }).getByRole("button").click();
  await expect(deck(page, "B")).toContainText("Test Groove A");
  // Eject and reload works.
  await deck(page, "B").getByRole("button", { name: "Eject Deck B" }).click();
  await expect(deck(page, "B")).toContainText("Empty");
  await deck(page, "B").getByRole("button", { name: "Load track" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove A" }).getByRole("button").click();
  await page.screenshot({ path: "test-results/preload.png" });

  await page.locator("button[aria-busy]").click();
  // Deck A plays C from its drop (~0:45); A is cued on Deck B.
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/A:On air .*Test Groove C/);
  expect(seconds((await deck(page, "A").textContent()) ?? "")).toBeGreaterThanOrEqual(45);
  await expect(page.getByText("Up next").locator("..")).toContainText("Test Groove A");
  await expect.poll(async () => (await deckStates(page)).join(" ")).toMatch(/B:Cued .*Test Groove A/);
  expect(errors).toEqual([]);
});

test("the auto-DJ adds effects as the music changes, and the FX pad shows them", async ({ page }) => {
  const errors = collectErrors(page);
  await loadLibrary(page);
  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: /^Peak Hour/ }).click();
  await page.locator("button[aria-busy]").click();
  await expect(dropButton(page)).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(4000);
  await dropButton(page).click();
  // The staff riser lights first; in the last bar before the drop the auto-DJ closes the filter.
  const filter = page.getByRole("button", { name: "Filter", exact: true });
  await expect(filter).toHaveAttribute("data-active", "true", { timeout: 20_000 });
  await expect(page.getByText("Effects")).toContainText("auto");
  await page.screenshot({ path: "test-results/auto-fx.png" });
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).not.toMatch(/Mixing/);
  await expect(filter).toHaveAttribute("data-active", "false");
  expect(errors).toEqual([]);
});

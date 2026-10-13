import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary, startBooth } from "./helpers";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

test("with key lock on, a Drop builds up and lands without errors or dead air", async ({ page }) => {
  const errors = collectErrors(page);
  await loadLibrary(page);
  await page.getByLabel("Keep tracks in their original key while matching tempo").check();
  await startBooth(page);
  await page.waitForTimeout(6000);
  await dropButton(page).click();
  await expect(dropButton(page)).toHaveText(/Drop in \d:\d\d/);
  // Build-up: the next deck starts mixing in before the drop lands.
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 20_000 }).toMatch(/Mixing in/);
  // Hand-over: the requested drop deck ends up on air alone.
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).not.toMatch(/Mixing/);
  await expect(page.locator("body")).not.toContainText("Recovered automatically");
  await expect(page.locator("body")).not.toContainText("Key lock isn't available");
  expect(errors).toEqual([]);
});

test("Peak Hour swaps onto the next track's drop on its own", async ({ page }) => {
  const errors = collectErrors(page);
  await loadLibrary(page);
  await startBooth(page, "Peak Hour");
  // The planned transition is a drop swap, not a blend.
  await expect(page.getByText("Up next").locator("..")).toContainText("Drop");
  // It lands where the current track breaks down after its first drop (~bar 40, ~75 s in) and hands over.
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 120_000, intervals: [1000] }).toMatch(/Mixing in/);
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 60_000, intervals: [1000] }).not.toMatch(/Mixing/);
  await expect(page.locator("body")).not.toContainText("Recovered automatically");
  expect(errors).toEqual([]);
});

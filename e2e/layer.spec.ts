import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });

async function setKey(page: Page, title: string, key: string) {
  await page.getByRole("row", { name: new RegExp(title) }).getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog").getByLabel("Key").selectOption(key);
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
}

test("Layer: the next song plays over this one until Drop swaps them; only matching songs are offered", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await loadLibrary(page);
  // The generated songs are in clashing keys; make A and C match (both 8A).
  await setKey(page, "Test Groove A", "8A");
  await setKey(page, "Test Groove C", "8A");

  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: /^Groove/ }).click();
  await deck(page, "A").getByRole("button", { name: "Load track" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove A" }).getByRole("button").click();
  await deck(page, "B").getByRole("button", { name: "Load track" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove C" }).getByRole("button").click();
  await page.locator("button[aria-busy]").click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/B:Cued .*Test Groove C/);

  // C matches A in tempo and key: Layer brings it in on the next phrase.
  const layer = page.getByRole("button", { name: "Layer next song" });
  await expect(layer).toBeEnabled();
  await layer.click();
  await expect(page.getByText("Up next").locator("..")).toContainText("Layer");
  await expect(deck(page, "B")).toContainText("Layered", { timeout: 15_000 });
  await expect(deck(page, "A")).toContainText("On air");
  await expect(dropButton(page)).toHaveText("Drop · swap");
  await expect(page.getByText("Up next").locator("..")).toContainText("layered · Drop to swap");
  await page.screenshot({ path: "test-results/layer.png" });

  // Both keep playing until Drop: still layered a few seconds later.
  await page.waitForTimeout(5000);
  await expect(deck(page, "B")).toContainText("Layered");
  await dropButton(page).click();
  await expect(dropButton(page)).toHaveText(/Swap in \d:\d\d|Mixing…/);
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/B:On air .*Test Groove C/);

  // The next cued song (auto-picked, clashing key) can't be layered: Layer… offers only matching songs.
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/A:Cued/);
  await page.getByRole("button", { name: "Layer…" }).click();
  const picker = page.getByRole("dialog");
  await expect(picker).toContainText("Layer a song over this one");
  await expect(picker.getByRole("listitem")).toHaveCount(1);
  await expect(picker.getByRole("listitem")).toContainText("Test Groove A");
  await picker.getByRole("button", { name: "Close" }).click();

  await page.click("nav >> text=History");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("table")).toContainText("Layer");
  expect(errors).toEqual([]);
});

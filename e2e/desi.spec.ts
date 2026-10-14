import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary } from "./helpers";

const seconds = (s: string) => {
  const m = /(\d+):(\d\d)/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
/** Position shown on a deck, in seconds. */
async function deckTime(page: Page, letter: string): Promise<number> {
  return seconds((await page.getByRole("region", { name: `Deck ${letter}` }).textContent()) ?? "");
}
function editor(page: Page, title: string) {
  return page
    .getByRole("row", { name: new RegExp(title) })
    .getByRole("button", { name: "Edit" })
    .click()
    .then(() => page.getByRole("dialog"));
}

test("Desi Night: opener hook → dialogue → drop, then songs wait for Drop; Start from on the cued deck", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await loadLibrary(page);

  // Admin: song A is the opener — "Romantic" crate, hook = the 8 bars from its first drop.
  let d = await editor(page, "Test Groove A");
  await d.getByLabel("Add to crate").fill("Romantic");
  await d.getByRole("button", { name: "Add", exact: true }).click();
  await d.getByRole("button", { name: "▶ Drop" }).click();
  // Mark now works once the preview is actually playing.
  await expect(d.getByRole("button", { name: "Mark hook starts now" })).toBeEnabled();
  await d.getByRole("button", { name: "Mark hook starts now" }).click();
  await d.getByRole("button", { name: "Mark hook ends now" }).click();
  for (let i = 0; i < 8; i++) await d.getByRole("button", { name: "Hook ends later" }).click();
  await d.getByRole("button", { name: "■ Stop" }).first().click();
  await expect(d.getByText("Hook ends")).toBeVisible();
  await d.getByRole("button", { name: "Done" }).click();

  // Admin: song B has a ~3 s "dialogue" at its start.
  d = await editor(page, "Test Groove B");
  await d.getByRole("button", { name: "▶ Song start" }).click();
  await expect(d.getByRole("button", { name: "Mark dialogue starts now" })).toBeEnabled();
  await d.getByRole("button", { name: "Mark dialogue starts now" }).click();
  await page.waitForTimeout(3000);
  await d.getByRole("button", { name: "Mark dialogue ends now" }).click();
  await d.getByRole("button", { name: "■ Stop" }).first().click();
  // The editor can audition it.
  await d.getByRole("button", { name: "▶ Try dialogue → drop" }).click();
  await expect(d.getByRole("button", { name: "■ Stop" }).last()).toBeVisible();
  await d.getByRole("button", { name: "■ Stop" }).last().click();
  await d.getByRole("button", { name: "Done" }).click();

  // Staff: queue B, pick Desi Night, play.
  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: /^Desi Night/ }).click();
  await page.getByRole("button", { name: "Add track" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove B" }).getByRole("button").click();
  await page.locator("button[aria-busy]").click();

  // Opener: A plays from its hook (its first drop, ~0:45), with B up next as dialogue → drop.
  await expect(page.getByText("Opening with the hook of Test Groove A")).toBeVisible({ timeout: 30_000 });
  expect(await deckTime(page, "A")).toBeGreaterThanOrEqual(44);
  await expect(page.getByText("Up next").locator("..")).toContainText("Dialogue → drop");

  // When the hook ends (8 bars ≈ 15 s) B's dialogue plays, then B jumps to its drop (~0:45).
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 40_000 }).toMatch(/B:On air .*Test Groove B/);
  await expect.poll(() => deckTime(page, "B"), { timeout: 15_000 }).toBeGreaterThanOrEqual(45);
  await expect(page.getByText("Opening with the hook")).toHaveCount(0);

  // Now songs wait for Drop.
  await expect(page.getByText("Up next").locator("..")).toContainText("waits for Drop", { timeout: 20_000 });

  // Start from on the cued deck: choose Beginning, then Drop.
  const cued = page.getByRole("region", { name: "Deck A" });
  await cued.getByRole("radio", { name: "Beginning" }).click();
  await expect(cued.getByRole("radio", { name: "Beginning" })).toHaveAttribute("aria-checked", "true");
  await cued.getByRole("radio", { name: "Drop" }).click();
  await expect(cued.getByRole("radio", { name: "Drop" })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: "test-results/desi-night.png" });

  // Staff press Drop: the cued song comes in within seconds and takes over.
  await dropButton(page).click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/A:On air/);
  await expect(page.locator("body")).not.toContainText("Recovered automatically");
  expect(errors).toEqual([]);
});

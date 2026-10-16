import { expect, test } from "@playwright/test";

test("the Help page explains the app: reachable from the nav, every contents link lands on its section", async ({ page }) => {
  await page.goto("/booth");
  await page.getByRole("link", { name: "Help" }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page).toHaveTitle("Help · AI DJ Mixer");
  await expect(page.getByRole("heading", { level: 1, name: "How to use AI DJ Mixer" })).toBeVisible();

  // Every entry in the contents has a section with a heading.
  const contents = page.getByRole("navigation", { name: "Contents" }).getByRole("link");
  const hrefs = await contents.evaluateAll((links) => links.map((a) => a.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThanOrEqual(20);
  for (const href of hrefs) await expect(page.locator(`section${href} h2`)).toHaveCount(1);

  // Jumping to a section scrolls it into view.
  await contents.filter({ hasText: "Tempo sliders" }).click();
  await expect(page).toHaveURL(/#tempo$/);
  await expect(page.getByRole("heading", { level: 2, name: "Tempo sliders" })).toBeInViewport();
  await expect(page.getByText(/swipe backwards \(anticlockwise\) fast/)).toBeAttached();
  await page.screenshot({ path: "test-results/help.png" });

  // And back to the booth from a link in the text.
  await page.locator("#quick-start").getByRole("link", { name: "Booth" }).click();
  await expect(page).toHaveURL(/\/booth$/);
});

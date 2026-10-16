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
  await expect(page.getByText(/swipe round anticlockwise fast/)).toBeAttached();
  await expect(page.getByText(/twist anticlockwise/)).toBeAttached();
  await page.screenshot({ path: "test-results/help.png" });

  // The contents highlight the section being read: the one clicked, then whichever scrolls up to the reading line.
  const current = page.getByRole("navigation", { name: "Contents" }).locator('[aria-current="location"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText("Tempo sliders and Sync");
  await page.evaluate(() => window.scrollTo(0, document.getElementById("loops")!.offsetTop - 40));
  await expect(current).toHaveText("Loops");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(current).toHaveText("Troubleshooting");
  // A section near the end (it can't reach the reading line) stays highlighted once picked.
  await contents.filter({ hasText: "Keyboard and mouse" }).click();
  await expect(current).toHaveText("Keyboard and mouse");
  await page.waitForTimeout(1200);
  await expect(current).toHaveText("Keyboard and mouse");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(current).toHaveText("Quick start");

  // And back to the booth from a link in the text.
  await page.locator("#quick-start").getByRole("link", { name: "Booth" }).click();
  await expect(page).toHaveURL(/\/booth$/);
});

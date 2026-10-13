import { expect, test } from "@playwright/test";

test("the booth reloads with no network once it has been opened", async ({ page, context }) => {
  await page.goto("/booth");
  // Wait for the service worker to take control, then visit the other pages once.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  for (const path of ["/library", "/moods", "/history", "/booth"]) await page.goto(path);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mood" })).toBeVisible();
  // Offline is detected by a background connectivity check; give it time on a busy machine.
  await expect(page.getByRole("status")).toContainText("Offline", { timeout: 20_000 });
  // Every page opened before loads offline too (a kiosk reboot lands on any of them).
  await page.goto("/library");
  await expect(page.getByText("Key lock (beta)")).toBeVisible();
  await page.goto("/history");
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  await context.setOffline(false);
});

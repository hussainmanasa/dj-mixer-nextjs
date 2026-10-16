import { expect, test } from "@playwright/test";
import { loadLibrary } from "./helpers";

test("while the track picker is open the booth behind it doesn't scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await loadLibrary(page);
  await page.click("nav >> text=Booth");
  const scrollY = () => page.evaluate(() => window.scrollY);
  // The booth is taller than the window: it scrolls normally.
  await page.mouse.move(640, 300);
  await page.mouse.wheel(0, 400);
  await expect.poll(scrollY).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole("region", { name: "Deck A" }).getByRole("button", { name: "Load track" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const before = await scrollY();
  // The wheel over the dark backdrop, and over the song list scrolled to its end: the page stays put.
  await page.mouse.move(20, 300);
  await page.mouse.wheel(0, 800);
  const list = dialog.getByRole("list");
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 800);
  await page.waitForTimeout(300);
  expect(await scrollY()).toBe(before);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");

  // Closed: the page scrolls again.
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  await page.mouse.move(640, 300);
  await page.mouse.wheel(0, 400);
  await expect.poll(scrollY).toBeGreaterThan(before);
});

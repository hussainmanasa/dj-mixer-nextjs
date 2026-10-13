import { expect, test } from "@playwright/test";
import { loadLibrary } from "./helpers";

test("admin can flag, crate and fix a track; fixes show in the table", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);

  // Volume matching: track B is mastered 6 dB quieter and gets a bigger boost than A.
  const gain = async (name: string) => Number((await page.getByRole("row", { name: new RegExp(name) }).locator("td").nth(4).textContent())?.replace(/[^\d.+-]/g, ""));
  expect((await gain("Test Groove B")) - (await gain("Test Groove A"))).toBeGreaterThan(5);

  const row = page.getByRole("row", { name: /Test Groove C/ });
  await row.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "★ Favourite" }).click();
  await dialog.getByLabel("Add to crate").fill("Friday");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByText("2 drops found")).toBeVisible();
  await dialog.getByLabel("Key").selectOption("5A");
  await page.screenshot({ path: "test-results/library-editor.png" });

  // Grid fix: listen (booth is stopped), then apply a corrected BPM, which re-analyses the track.
  await dialog.getByRole("button", { name: "Listen with clicks" }).click();
  await expect(dialog.getByRole("button", { name: "Stop" })).toBeVisible();
  await dialog.getByRole("button", { name: "Stop" }).click();
  await dialog.getByLabel("BPM").fill("127.5");
  await dialog.getByRole("button", { name: "Apply grid" }).click();
  await expect(dialog.getByRole("button", { name: "Apply grid" })).toBeDisabled({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Done" }).click();

  await expect(row).toContainText("★");
  await expect(row).toContainText("Friday");
  await expect(row).toContainText("127.5");
  await expect(row).toContainText("5A");
  await expect(row).toContainText("set by hand");

  // Filters.
  await page.getByRole("tab", { name: /Favourites/ }).click();
  await expect(page.getByRole("row", { name: /Test Groove/ })).toHaveCount(1);
  await page.getByRole("tab", { name: /All/ }).click();
  await page.getByLabel("Crate").selectOption("Friday");
  await expect(page.getByRole("row", { name: /Test Groove/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});

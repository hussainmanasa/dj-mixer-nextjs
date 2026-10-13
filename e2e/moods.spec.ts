import { expect, test } from "@playwright/test";

test("admin edits a mood; the booth uses it; reset restores the preset", async ({ page }) => {
  await page.goto("/moods");
  const peak = page.getByRole("region", { name: "Peak Hour mood" });
  await peak.getByLabel("Lowest BPM").fill("126");
  await peak.getByLabel("Highest BPM").fill("134");
  await peak.getByLabel("Blend length").selectOption("32");
  await peak.getByRole("button", { name: "Save" }).click();
  await expect(peak.getByText("Edited")).toBeVisible();

  // Invalid range: an error shows and Save is disabled.
  await peak.getByLabel("Lowest BPM").fill("140");
  await expect(peak.getByText("BPM range must go from low to high")).toBeVisible();
  await expect(peak.getByRole("button", { name: "Save" })).toBeDisabled();
  await peak.getByRole("button", { name: "Undo changes" }).click();
  await page.screenshot({ path: "test-results/moods-editor.png", fullPage: true });

  await page.click("nav >> text=Booth");
  await expect(page.getByRole("button", { name: /Peak Hour/ })).toContainText("126–134 BPM");

  // Edits survive a reload (saved in the browser), and reset brings the preset back.
  await page.goto("/moods");
  const again = page.getByRole("region", { name: "Peak Hour mood" });
  await expect(again.getByLabel("Lowest BPM")).toHaveValue("126");
  await again.getByRole("button", { name: "Reset to default" }).click();
  await expect(again.getByLabel("Lowest BPM")).toHaveValue("124");
  await expect(again.getByText("Edited")).toHaveCount(0);
});

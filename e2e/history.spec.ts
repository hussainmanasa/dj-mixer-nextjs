import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { deckStates, dropButton, loadLibrary, startBooth } from "./helpers";

test("plays are logged by night and exported as CSV", async ({ page }) => {
  await loadLibrary(page);
  await startBooth(page, "Groove");

  // Press Drop so a second track starts quickly, then wait for the hand-over.
  await page.waitForTimeout(4000);
  await dropButton(page).click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/Mixing in/);
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).not.toMatch(/Mixing/);
  await page.click("nav >> text=History");
  await page.getByRole("button", { name: "Refresh" }).click();
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(3); // header + set start + drop swap
  await expect(table).toContainText("Set start");
  await expect(table).toContainText("Drop swap");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export night (CSV)" }).click();
  const csv = readFileSync(await (await download).path(), "utf8");
  expect(csv.split("\r\n")[0]).toBe("Night,Started,Played (s),Title,Artist,File,Mood,Came in by,Requested,BPM,Key");
  expect(csv).toContain("Drop swap");
});

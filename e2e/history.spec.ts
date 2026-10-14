import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { deckStates, dropButton, loadLibrary, startBooth } from "./helpers";

test("plays are logged by night, exported as CSV, and the queue is saved", async ({ page }) => {
  await loadLibrary(page);
  await startBooth(page, "Groove");

  // Queue a track: it's saved with the session so a reload can restore it.
  await page.getByRole("button", { name: "Add track" }).click();
  const first = page.getByRole("dialog").getByRole("listitem").first();
  const queued = (await first.locator("p").first().textContent())!.trim();
  await first.getByRole("button").last().click();
  const savedQueue = () =>
    page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const open = indexedDB.open("ai-dj-mixer");
          // Never create the app's database from the test (that would leave it without its store).
          open.onupgradeneeded = () => open.transaction?.abort();
          open.onerror = () => resolve([]);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("kv")) return (db.close(), resolve([]));
            const req = db.transaction("kv").objectStore("kv").get("session:last");
            req.onsuccess = () => (db.close(), resolve(req.result?.queue ?? []));
            req.onerror = () => (db.close(), resolve([]));
          };
        }),
    );
  await expect.poll(savedQueue).toHaveLength(1);

  // Press Drop so a second track starts quickly, then wait for the hand-over.
  await page.waitForTimeout(4000);
  await dropButton(page).click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/Mixing in/);
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).not.toMatch(/Mixing/);
  // The queued track is up next now (requested), and has left the saved queue.
  await expect(page.getByText("Up next").locator("..")).toContainText(queued);
  await expect(page.getByText("Up next").locator("..")).toContainText("Requested");
  await expect.poll(savedQueue).toHaveLength(0);

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

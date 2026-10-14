import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });

/** Pretend a separate headphone output is chosen (headless Chrome has no devices; it falls back to the default). */
async function separatePreviewOutput(page: Page) {
  await page.goto("/library");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("ai-dj-mixer");
        open.onupgradeneeded = () => open.result.createObjectStore("kv");
        open.onsuccess = () => {
          const tx = open.result.transaction("kv", "readwrite");
          tx.objectStore("kv").put({ deckCount: 2, keyLock: false, moods: {}, mainOutput: "", previewOutput: "test-headphones" }, "settings");
          tx.oncomplete = () => (open.result.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test("a cue on the cued deck stops when its mix starts", async ({ page }) => {
  await separatePreviewOutput(page);
  await loadLibrary(page);
  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: /^Peak Hour/ }).click();
  await page.locator("button[aria-busy]").click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/B:Cued/);

  // With a separate preview output, the cued deck can be cued during the set.
  await deck(page, "B").getByRole("button", { name: "🎧 Cue" }).click();
  await expect(deck(page, "B").getByRole("button", { name: "■ Stop cue" })).toBeVisible();
  await expect(deck(page, "B")).toContainText(/cue \d+:\d\d\.\d/);

  // Its mix starts: the cue stops by itself.
  await page.waitForTimeout(2000);
  await dropButton(page).click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 20_000 }).toMatch(/B:Mixing in/);
  await expect(deck(page, "B")).not.toContainText(/cue \d+:\d\d\.\d/, { timeout: 5000 });
});

test("the jog wheel sets a loaded deck's start: keys, drag and scroll", async ({ page }) => {
  await loadLibrary(page);
  await page.click("nav >> text=Booth");
  await deck(page, "A").getByRole("button", { name: "Load track" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove C" }).getByRole("button").last().click();

  const jog = page.getByRole("slider", { name: "Start point, Deck A" });
  const chip = () => deck(page, "A").getByText(/^Bar \d+\.\d$/);
  // Keys: four beats → bar 2; Shift = a bar → bar 3.
  await jog.focus();
  for (let i = 0; i < 4; i++) await jog.press("ArrowRight");
  await expect(chip()).toHaveText("Bar 2.1");
  await jog.press("Shift+ArrowRight");
  await expect(chip()).toHaveText("Bar 3.1");

  // Drag a quarter turn clockwise (top → right) = 4 beats = one more bar.
  const box = (await jog.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.width * 0.35;
  await page.mouse.move(cx, cy - r);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    const t = ((Math.PI / 2) * i) / 10;
    await page.mouse.move(cx + r * Math.sin(t), cy - r * Math.cos(t));
  }
  await page.mouse.up();
  await expect(chip()).toHaveText("Bar 4.1");

  // Scroll over it: one beat per notch. Home: back to the beginning.
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, 100);
  await expect(chip()).toHaveText("Bar 4.2");
  await jog.press("Home");
  await expect(chip()).toHaveText("Bar 1.1");
  await page.screenshot({ path: "test-results/jog.png" });

  // On air the jog wheel is display-only.
  await page.locator("button[aria-busy]").click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/A:On air/);
  await expect(page.getByRole("slider", { name: "Start point, Deck A" })).toHaveCount(0);
});

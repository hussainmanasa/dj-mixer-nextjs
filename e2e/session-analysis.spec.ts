import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, webkit, type Browser, type Page } from "@playwright/test";
import { FIXTURE_DIR } from "./fixtures";

const songs = () => readdirSync(FIXTURE_DIR).map((f) => join(FIXTURE_DIR, f));
const ready = (page: Page, n: number) =>
  page.waitForFunction((n) => new RegExp(`${n} ready`).test(document.body.innerText), n, { timeout: 120_000 });

/** Notes whether "Analysing" ever shows on the page (set before the page loads). */
async function watchAnalysing(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { sawAnalysing: boolean };
    w.sawAnalysing = false;
    new MutationObserver(() => {
      // The progress line ("Analysing 1 of 4: …") shows only while songs are really analysed.
      if (/Analysing \d+ of \d+/.test(document.body?.innerText ?? "")) w.sawAnalysing = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}
const sawAnalysing = (page: Page) => page.evaluate(() => (window as unknown as { sawAnalysing: boolean }).sawAnalysing);

/** Add songs for this session (the iPad / USB way), wait until all are ready. */
async function addSession(page: Page, files: string[], count: number) {
  await page.goto("/library");
  await page.setInputFiles('[data-testid="session-files"]', files);
  await ready(page, count);
}

test("session songs (e.g. from a USB drive): this device remembers their analysis, so picking them again is instant", async ({ page }) => {
  test.setTimeout(240_000);
  await watchAnalysing(page);
  await addSession(page, songs(), songs().length);
  expect(await sawAnalysing(page)).toBe(true);

  // A reload forgets the files (the browser can't reopen them) — picking them again needs no analysis.
  await page.reload();
  await expect(page.getByText(`${songs().length} ready`)).toHaveCount(0);
  await addSession(page, songs(), songs().length);
  expect(await sawAnalysing(page)).toBe(false);
});

/** In a fresh browser: the songs plus the downloaded file are ready at once, with the edits that were made. */
async function freshWithFile(browser: Browser, baseURL: string | undefined, file: string) {
  const ctx = await browser.newContext({ baseURL });
  try {
    const page = await ctx.newPage();
    await watchAnalysing(page);
    await addSession(page, [...songs(), file], songs().length);
    expect(await sawAnalysing(page)).toBe(false);
    await expect(page.getByRole("row", { name: /Test Groove B/ })).toContainText("⛔");
  } finally {
    await ctx.close();
  }
}

test("“Download analysis file”, picked with the songs in a fresh browser, makes them ready without analysing — in Chromium and Safari's WebKit", async ({ page, browser, baseURL }) => {
  test.setTimeout(300_000);
  await addSession(page, songs(), songs().length);
  // An edit to travel with it.
  await page.getByRole("row", { name: /Test Groove B/ }).getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "⛔ Never play" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download analysis file" }).click();
  const file = test.info().outputPath("ai-dj-mixer-settings.json");
  await (await download).saveAs(file);
  expect((await download).suggestedFilename()).toBe("ai-dj-mixer-settings.json");

  await freshWithFile(browser, baseURL, file);
  if (existsSync(webkit.executablePath())) {
    const safari = await webkit.launch();
    try {
      await freshWithFile(safari, baseURL, file);
    } finally {
      await safari.close();
    }
  }
});

test("songs picked one at a time add up — two different songs with the same file name both stay, each with its own sound", async ({ page }) => {
  test.setTimeout(240_000);
  const [a, b] = songs().filter((f) => f.endsWith(".wav"));
  // Two different songs, both called "song.wav" (as two folders on a USB drive could have).
  const one = test.info().outputPath("one");
  const two = test.info().outputPath("two");
  mkdirSync(one, { recursive: true });
  mkdirSync(two, { recursive: true });
  copyFileSync(a, join(one, "song.wav"));
  copyFileSync(b, join(two, "song.wav"));
  await page.goto("/library");
  await page.setInputFiles('[data-testid="session-files"]', join(one, "song.wav"));
  await ready(page, 1);
  await page.setInputFiles('[data-testid="session-files"]', join(two, "song.wav"));
  await ready(page, 2);
  // Both rows, each analysed from its own file (their tempos differ).
  const rows = page.getByRole("row", { name: /^song/ });
  const bpms = async () => new Set((await rows.allInnerTexts()).map((t) => t.match(/\b(1[0-9]{2}\.\d)\b/)?.[1]));
  await expect(rows).toHaveCount(2);
  expect((await bpms()).size).toBe(2);
  // Picked together, too (in a fresh page): neither replaces the other before it's analysed.
  await page.reload();
  await page.evaluate(() => new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase("ai-dj-mixer");
    req.onsuccess = req.onerror = req.onblocked = () => r();
  }));
  await page.reload();
  await page.setInputFiles('[data-testid="session-files"]', [join(one, "song.wav"), join(two, "song.wav")]);
  await ready(page, 2);
  await expect(rows).toHaveCount(2);
  expect((await bpms()).size).toBe(2);
});

test("“Add a folder (this session only)” adds a whole folder at once", async ({ page }) => {
  await page.goto("/library");
  await page.setInputFiles('[data-testid="session-folder"]', FIXTURE_DIR);
  await ready(page, songs().length);
});

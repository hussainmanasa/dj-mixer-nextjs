import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_DIR } from "./fixtures";
import { deckStates } from "./helpers";

/** A music folder in the browser's own storage, handed to the app as if it had been picked (Playwright can't drive the picker). */
async function musicFolder(page: Page, extra: Record<string, string> = {}) {
  await page.goto("/library");
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".wav"));
  for (const name of files) {
    const bytes = readFileSync(join(FIXTURE_DIR, name)).toString("base64");
    await page.evaluate(
      async ({ name, bytes }) => {
        const root = await navigator.storage.getDirectory();
        const d = await root.getDirectoryHandle("music", { create: true });
        const w = await (await d.getFileHandle(name, { create: true })).createWritable();
        await w.write(Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)));
        await w.close();
      },
      { name, bytes },
    );
  }
  for (const [name, text] of Object.entries(extra)) {
    await page.evaluate(
      async ({ name, text }) => {
        const root = await navigator.storage.getDirectory();
        const d = await root.getDirectoryHandle("music", { create: true });
        const w = await (await d.getFileHandle(name, { create: true })).createWritable();
        await w.write(text);
        await w.close();
      },
      { name, text },
    );
  }
  return files.length;
}

async function pickMusicFolder(page: Page, songs: number) {
  await page.evaluate(async () => {
    const music = await (await navigator.storage.getDirectory()).getDirectoryHandle("music");
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => music;
  });
  await page.getByRole("button", { name: /Choose (music|another) folder/ }).click();
  await page.waitForFunction((n) => new RegExp(`${n} ready`).test(document.body.innerText), songs, { timeout: 120_000 });
}

const readFolderFile = (page: Page, name: string) =>
  page.evaluate(async (name) => {
    const music = await (await navigator.storage.getDirectory()).getDirectoryHandle("music");
    try {
      return await (await (await music.getFileHandle(name)).getFile()).text();
    } catch {
      return null;
    }
  }, name);

test("settings travel with the music folder: imported on open, kept up to date, back on a new computer", async ({ page }) => {
  test.setTimeout(240_000);
  const setup = {
    app: "ai-dj-mixer",
    version: 1,
    savedAt: Date.now(),
    settings: { deckCount: 3, volume: 0.4 },
    tracks: {
      "unknown-id": { path: "Test Groove C 127.wav", title: "Test Groove C 127", flag: "favourite", crates: ["Romantic"] },
      "other-id": { path: "Test Groove A 126.wav", title: "Test Groove A 126", cues: { start: 1.4, end: 31.9 } },
    },
  };
  const songs = await musicFolder(page, { "club-setup.json": JSON.stringify(setup) });
  await pickMusicFolder(page, songs);

  // Imported from the folder's JSON (found by its contents, whatever it's called), matched by path.
  const note = page.getByRole("status", { name: "Settings file" });
  await expect(note).toContainText("Imported settings and edits for 2 songs from club-setup.json");
  await expect(page.getByRole("row", { name: /Test Groove C/ })).toContainText("★");
  await expect(page.getByRole("row", { name: /Test Groove C/ })).toContainText("Romantic");
  await expect(page.getByRole("radiogroup", { name: "Number of decks" }).getByRole("radio", { name: "3" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("slider", { name: "Club speakers volume" })).toHaveValue("40");

  // The app keeps its own file in the folder (this folder may be written) — with every edit.
  await expect(note).toContainText("saved in the music folder as ai-dj-mixer-settings.json", { timeout: 10_000 });
  await page.getByRole("row", { name: /Test Groove B/ }).getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "⛔ Never play" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect
    .poll(async () => JSON.parse((await readFolderFile(page, "ai-dj-mixer-settings.json")) ?? "{}"), { timeout: 10_000 })
    .toMatchObject({
      app: "ai-dj-mixer",
      settings: { deckCount: 3, volume: 0.4 },
    });
  await expect.poll(async () => (await readFolderFile(page, "ai-dj-mixer-settings.json")) ?? "", { timeout: 10_000 }).toContain('"flag": "ban"');
  const saved = JSON.parse((await readFolderFile(page, "ai-dj-mixer-settings.json"))!);
  expect(JSON.stringify(saved)).not.toMatch(/mainOutput|previewOutput/);
  expect(Object.values(saved.tracks).map((t) => (t as { path: string }).path)).toEqual(
    expect.arrayContaining(["Test Groove A 126.wav", "Test Groove B 128.wav", "Test Groove C 127.wav"]),
  );

  // A new computer: nothing saved in the browser. Open the same folder: everything comes back from the file.
  await page.goto("/help");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const r = indexedDB.deleteDatabase("ai-dj-mixer");
        r.onsuccess = r.onerror = r.onblocked = () => resolve();
      }),
  );
  await page.goto("/library");
  await expect(page.getByText("Not connected")).toBeVisible();
  await pickMusicFolder(page, songs);
  await expect(note).toContainText(/Imported settings and edits for 3 songs from ai-dj-mixer-settings\.json/);
  await expect(page.getByRole("row", { name: /Test Groove B/ })).toContainText("⛔");
  await expect(page.getByRole("row", { name: /Test Groove C/ })).toContainText("★");
  await expect(page.getByRole("slider", { name: "Club speakers volume" })).toHaveValue("40");

  // Cue out (from the file): the auto-DJ hands over there — about 0:32 — instead of after the song's drops.
  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: "Load track, Deck A" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove A" }).getByRole("button").last().click();
  await page.getByRole("button", { name: /^Groove/ }).click();
  await page.locator("button[aria-busy]").click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/A:On air/);
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 60_000 }).toMatch(/A:Mixing out/);
  const played = Number((await deckStates(page)).find((d) => d.startsWith("A:"))!.match(/\d+:(\d\d) \//)![1]);
  expect(played).toBeLessThan(32);
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 40_000 }).toMatch(/A:(Cued|Empty|Standby)|B:On air|C:On air/);
});

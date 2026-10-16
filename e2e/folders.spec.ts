import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FIXTURE_DIR } from "./fixtures";

/**
 * A music folder with subfolders. Playwright can't drive the folder picker, so this stands in for one: the
 * fixture files become a folder handle (via the origin-private file system) with "Bollywood/Romantic", "Punjabi"
 * and a song at the top, and the Library opens it as if it had been picked.
 */
test("the Library shows the music folder as it is: folders and subfolders that open, with counts and progress", async ({ page }) => {
  await page.goto("/library");
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".wav"));
  const layout: Record<string, string> = {
    [files[0]]: "Bollywood/Romantic",
    [files[1]]: "Bollywood",
    [files[2]]: "Punjabi",
    [files[3]]: "",
  };
  // Build the folder in the page.
  for (const [name, dir] of Object.entries(layout)) {
    const bytes = readFileSync(join(FIXTURE_DIR, name)).toString("base64");
    await page.evaluate(
      async ({ name, dir, bytes }) => {
        const root = await navigator.storage.getDirectory();
        let d = await root.getDirectoryHandle("music", { create: true });
        for (const part of dir.split("/").filter(Boolean)) d = await d.getDirectoryHandle(part, { create: true });
        const f = await d.getFileHandle(name, { create: true });
        const w = await f.createWritable();
        await w.write(Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)));
        await w.close();
      },
      { name, dir, bytes },
    );
  }
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const music = await root.getDirectoryHandle("music");
    // Pretend the user picked it.
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () => music;
  });
  await page.getByRole("button", { name: /Choose music folder/ }).click();
  await page.waitForFunction(() => /4 ready/.test(document.body.innerText), null, { timeout: 120_000 });

  const table = page.locator("table");
  // Top level: the two folders (closed) and the loose song.
  const bollywood = page.getByRole("button", { name: "Open folder Bollywood" });
  await expect(bollywood).toContainText("2 songs");
  await expect(page.getByRole("button", { name: "Open folder Punjabi" })).toContainText("1 song");
  await expect(table).toContainText(files[3].replace(/\.wav$/, "").replace(/ \d+$/, ""));
  await expect(page.getByRole("button", { name: "Open folder Romantic" })).toHaveCount(0);

  // Open Bollywood: its song and its subfolder; open that too.
  await bollywood.click();
  await expect(page.getByRole("button", { name: "Close folder Bollywood" })).toBeVisible();
  await page.getByRole("button", { name: "Open folder Romantic" }).click();
  await expect(page.getByRole("button", { name: "Close folder Romantic" })).toContainText("1 song");
  await page.screenshot({ path: "test-results/folders.png", fullPage: true });

  // Collapse all / Expand all, and the plain list is still there.
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.getByRole("button", { name: "Open folder Romantic" })).toHaveCount(0);
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByRole("button", { name: "Close folder Romantic" })).toBeVisible();
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.getByRole("button", { name: /^(Open|Close) folder/ })).toHaveCount(0);
  await expect(table.getByRole("button", { name: "Edit" })).toHaveCount(4);
});

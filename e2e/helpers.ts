import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { FIXTURE_DIR } from "./fixtures";

/** Add the fixture tracks for this session and wait until all are analysed. */
export async function loadLibrary(page: Page, dirs: string[] = [FIXTURE_DIR]): Promise<void> {
  await page.goto("/library");
  const files = dirs.flatMap((dir) => readdirSync(dir).map((f) => join(dir, f)));
  await page.setInputFiles('[data-testid="session-files"]', files);
  await page.waitForFunction((n) => new RegExp(`${n} ready`).test(document.body.innerText), files.length, { timeout: 120_000 });
}

/** Go to the booth (client-side, so session files stay loaded) and start a mood. */
export async function startBooth(page: Page, mood = "Peak Hour"): Promise<void> {
  await page.click("nav >> text=Booth");
  // By role: visited pages stay mounted but hidden, and text like "Groove" also matches track names there.
  await page.getByRole("button", { name: new RegExp(`^${mood}`) }).click();
  await page.locator("button[aria-busy]").click();
  await page.waitForFunction(() => /Beat-matched blend|Filter sweep|Echo-out|Cut on|Drop\b/.test(document.body.textContent ?? ""), null, {
    timeout: 30_000,
  });
}

export const dropButton = (page: Page) => page.locator('button[title="Bring the next track in on its drop"]');

/** Deck panels as "A:<state> <time> <title>". */
export function deckStates(page: Page): Promise<string[]> {
  return page.$$eval('section[aria-label^="Deck"]', (els) =>
    els.map((e) => {
      const t = (e.textContent ?? "").replace(/\s+/g, " ");
      const state = t.match(/(On air|Cued|Mixing in|Mixing out|Standby|Empty)/)?.[0] ?? "";
      return `${e.getAttribute("aria-label")?.slice(-1)}:${state} ${t.match(/\d+:\d\d \/ −\d+:\d\d/)?.[0] ?? ""} ${t.match(/Test Groove \w/)?.[0] ?? ""}`;
    }),
  );
}

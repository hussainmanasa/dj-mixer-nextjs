import { expect, test, type Page } from "@playwright/test";
import { deckStates, loadLibrary } from "./helpers";

const row = (page: Page, letter: string) => page.getByRole("group", { name: `Track view, Deck ${letter}` });
const states = async (page: Page) => (await deckStates(page)).join(" ");
/** Coloured (non-background) pixels drawn in a row's canvas. */
const inked = (page: Page, letter: string) =>
  row(page, letter)
    .locator("canvas")
    .evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i + 1] > 120) n++;
      return n;
    });
const barOf = async (page: Page, letter: string) => (await row(page, letter).getByText(/^Bar/).textContent())!.replace("Bar", "").trim();

test("track view: the decks' songs one below another, with waveform, beats, bar and phrase", async ({ page }) => {
  await loadLibrary(page);
  await page.click("nav >> text=Booth");
  // Before Play: a loaded deck gets its row.
  await page.getByRole("region", { name: "Deck A" }).getByRole("button", { name: "Load track" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove A" }).getByRole("button").last().click();
  await expect(row(page, "A")).toContainText("Loaded");
  await expect(row(page, "A")).toContainText("Test Groove A 126");

  await page.locator("button[aria-busy]").click();
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  await expect(row(page, "A")).toContainText("On air");
  await expect(row(page, "B")).toContainText("Cued");
  // The rows sit one below the other.
  const [ba, bb] = [(await row(page, "A").boundingBox())!, (await row(page, "B").boundingBox())!];
  expect(bb.y).toBeGreaterThan(ba.y + ba.height - 1);

  // The detailed waveform is built (and kept for next time), and drawn.
  await expect.poll(() => inked(page, "A"), { timeout: 15_000 }).toBeGreaterThan(2000);
  const waves = await page.evaluate(
    () =>
      new Promise<number>((res) => {
        const r = indexedDB.open("ai-dj-mixer");
        r.onsuccess = () => {
          const q = r.result.transaction("kv").objectStore("kv").getAllKeys();
          q.onsuccess = () => res((q.result as IDBValidKey[]).filter((k) => String(k).startsWith("wave:")).length);
        };
      }),
  );
  expect(waves).toBeGreaterThanOrEqual(2);

  // Bar and phrase move with the music; BPM and the next drop are shown.
  const first = await barOf(page, "A");
  await expect.poll(() => barOf(page, "A")).not.toBe(first);
  await expect(row(page, "A")).toContainText(/Phrase \d+ · \d\/8/);
  await expect(row(page, "A")).toContainText("126.0");
  await expect(row(page, "A")).toContainText(/drop in \d+:\d\d|in a drop/);

  // Zoom.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByRole("region", { name: "Track view" })).toContainText("4 s");
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.getByRole("region", { name: "Track view" })).toContainText("16 s");

  // Playing together (beat-matched) both rows count the same beat.
  await page.getByRole("region", { name: "Deck B" }).getByRole("button", { name: "Play Deck B now" }).click();
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/B:Playing along/);
  await expect(row(page, "A")).toContainText("On air");
  await expect(row(page, "B")).toContainText("Playing along");
  let same = 0;
  for (let i = 0; i < 10; i++) {
    const [x, y] = await Promise.all([barOf(page, "A"), barOf(page, "B")]);
    if (x.split(".")[1] === y.split(".")[1]) same++;
    await page.waitForTimeout(170);
  }
  expect(same).toBeGreaterThanOrEqual(8);
});

import { expect, test, type Page } from "@playwright/test";
import { deckStates, loadLibrary, startBooth, tapAudio } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const onAir = async (page: Page) => (await deckStates(page)).find((d) => d.includes(":On air"))!;
const title = (state: string) => state.split(" ").slice(-3).join(" ");
const keyLockBox = (page: Page) => page.getByRole("checkbox", { name: /Keep tracks in their original key/ });

test("key lock and the deck count change mid-set with no reload, and the music never restarts", async ({ page }) => {
  const taps = await tapAudio(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/A:On air/);
  const song = title(await onAir(page));
  await expect(deck(page, "A").getByText("Key lock", { exact: true })).toHaveCount(0);

  // Key lock on, from the Library page, while the set plays.
  await page.click("nav >> text=Library");
  await keyLockBox(page).check();
  await page.click("nav >> text=Booth");
  await expect(deck(page, "A").getByText("Key lock", { exact: true })).toBeVisible();
  expect((await taps.get()).worklets.filter((n) => n === "keylock").length).toBeGreaterThanOrEqual(2);
  expect(title(await onAir(page))).toBe(song);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);

  // And off again.
  await page.click("nav >> text=Library");
  await keyLockBox(page).uncheck();
  await page.click("nav >> text=Booth");
  await expect(deck(page, "A").getByText("Key lock", { exact: true })).toHaveCount(0);
  await taps.reset();
  await page.waitForTimeout(1500);
  expect((await taps.get()).pre).toBeGreaterThan(0.05);

  // 2 → 3 decks mid-set: Deck C appears and takes a standby song; 3 → 2: it goes (it's free).
  await page.click("nav >> text=Library");
  await page.getByRole("radiogroup", { name: "Number of decks" }).getByRole("radio", { name: "3" }).click();
  await page.click("nav >> text=Booth");
  await expect(deck(page, "C")).toBeVisible();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 15_000 }).toMatch(/C:Standby/);
  await page.click("nav >> text=Library");
  await page.getByRole("radiogroup", { name: "Number of decks" }).getByRole("radio", { name: "2" }).click();
  await page.click("nav >> text=Booth");
  await expect(deck(page, "C")).toHaveCount(0);
  expect(title(await onAir(page))).toBe(song);
  expect(errors).toEqual([]);
});

test("settings changed in another tab reach the booth without a refresh", async ({ page }) => {
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/A:On air/);
  const song = title(await onAir(page));

  const other = await page.context().newPage();
  await other.goto("/library");
  await keyLockBox(other).check();
  await other.getByRole("slider", { name: "Club speakers volume" }).fill("40");

  await expect(deck(page, "A").getByText("Key lock", { exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("slider", { name: "Club speakers volume" })).toHaveValue("40", { timeout: 5000 });
  // This tab's session-only songs are still here and the set carries on.
  expect(title(await onAir(page))).toBe(song);
  await expect(page.getByText(/\d+ tracks ready/)).not.toHaveText(/^0 tracks/);
  await other.close();
});

import { expect, test, type Page } from "@playwright/test";
import { deckStates, loadLibrary, startBooth } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });
const states = async (page: Page) => (await deckStates(page)).join(" ");

test("⏏ during the set: the cued deck empties and stays empty until LOAD; a playing song can't be ejected", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);

  // The song on air can't be ejected.
  await expect(deck(page, "A").getByRole("button", { name: "Eject Deck A" })).toBeDisabled();

  // Eject the cued song: Deck B is empty, the auto-DJ doesn't refill it, the music plays on.
  await deck(page, "B").getByRole("button", { name: "Eject Deck B" }).click();
  await expect.poll(() => states(page)).toMatch(/A:On air.*B:Empty/);
  await expect(page.getByText("Deck B is empty — LOAD a song")).toBeVisible();
  await page.waitForTimeout(4000);
  expect(await states(page)).toMatch(/A:On air.*B:Empty/);

  // LOAD fills it with the song staff choose.
  await page.getByRole("button", { name: "Choose track, Deck B" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove D" }).getByRole("button").last().click();
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(/A:On air.*B:Cued .*Test Groove D/);

  // Playing along it can't be ejected; paused, it can.
  await deck(page, "B").getByRole("button", { name: "Play Deck B" }).click();
  await expect.poll(() => states(page), { timeout: 3000 }).toMatch(/B:Playing along/);
  await expect(deck(page, "B").getByRole("button", { name: "Eject Deck B" })).toBeDisabled();
  await deck(page, "B").getByRole("button", { name: "Pause Deck B" }).click();
  await expect.poll(() => states(page)).toMatch(/B:Paused/);
  await deck(page, "B").getByRole("button", { name: "Eject Deck B" }).click();
  await expect.poll(() => states(page)).toMatch(/A:On air.*B:Empty/);
  expect(errors).toEqual([]);
});

test("LOAD on the deck on air works once it's paused (a playing song can't be replaced); ▶ plays the new song", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);
  await startBooth(page, "Groove");
  await expect.poll(() => states(page), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  const onA = (await deckStates(page)).find((d) => d.startsWith("A:"))!.split(" ").at(-1);
  const onB = (await deckStates(page)).find((d) => d.startsWith("B:"))!.split(" ").at(-1);
  const other = ["A", "B", "C", "D"].find((l) => l !== onA && l !== onB)!;

  // Playing: LOAD A is greyed out, and says why.
  const loadA = page.getByRole("button", { name: /, Deck A$/ }).filter({ hasText: "Load A" });
  await expect(loadA).toBeDisabled();
  await expect(loadA).toHaveAttribute("title", "Pause this deck first — a playing song can't be replaced");

  // Paused: LOAD A puts a new song there, stopped at its start.
  await deck(page, "A").getByRole("button", { name: "Pause Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(/A:Paused/);
  await page.getByRole("button", { name: "Change track, Deck A" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: `Test Groove ${other}` }).getByRole("button").last().click();
  await expect.poll(() => states(page), { timeout: 15_000 }).toMatch(new RegExp(`A:Paused 0:0\\d / .*Test Groove ${other}.*B:Cued .*Test Groove ${onB}`));

  // ▶ plays it.
  await deck(page, "A").getByRole("button", { name: "Play Deck A" }).click();
  await expect.poll(() => states(page)).toMatch(new RegExp(`A:On air .*Test Groove ${other}`));
  await page.waitForTimeout(2500);
  expect(await states(page)).toMatch(/A:On air 0:0[2-9]/);

  // The set log has it, as loaded by staff.
  await page.click("nav >> text=History");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("table")).toContainText("Loaded by staff");
  expect(errors).toEqual([]);
});

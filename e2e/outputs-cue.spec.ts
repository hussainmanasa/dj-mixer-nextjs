import { expect, test, type Page } from "@playwright/test";
import { deckStates, loadLibrary } from "./helpers";

const deck = (page: Page, letter: string) => page.getByRole("region", { name: `Deck ${letter}` });

test("audio outputs, Cue on a loaded deck with Set start here, picker preview, and Cue blocked on a shared output", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loadLibrary(page);

  // Library: choose outputs; with one output for both, previews are flagged as shared.
  const outputs = page.getByRole("region", { name: "Audio outputs" });
  await expect(outputs.getByLabel("Club speakers (the mix)", { exact: true })).toBeVisible();
  await expect(outputs.getByLabel("Preview & Cue (headphones)", { exact: true })).toHaveValue("none");
  await expect(outputs).toContainText("Previews and Cue share the club speakers");
  await outputs.getByRole("button", { name: "Test Club speakers (the mix)" }).click();

  // Booth, before Play: load Deck A and cue it.
  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: "Load track, Deck A" }).click();
  // The picker previews a song before choosing it.
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: "Preview Test Groove C 127" }).click();
  await expect(picker.getByRole("button", { name: "Stop preview of Test Groove C 127" })).toBeVisible();
  await picker.getByRole("listitem").filter({ hasText: "Test Groove C" }).getByRole("button").last().click();
  await expect(deck(page, "A")).toContainText("Test Groove C");

  const cue = page.getByRole("button", { name: "Listen, Deck A" });
  await cue.click();
  await expect(page.getByRole("button", { name: "Stop listening, Deck A" })).toBeVisible();
  // The cue playhead moves.
  const head = async () => {
    const m = ((await page.getByTestId("cue-head-A").textContent()) ?? "").match(/cue (\d+):(\d\d)\.(\d)/);
    return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10 : NaN;
  };
  const first = await expect.poll(head).toBeGreaterThan(0).then(() => head());
  await page.waitForTimeout(1500);
  expect(await head()).toBeGreaterThan(first);
  await page.getByRole("button", { name: "Set start here, Deck A" }).click();
  await expect(deck(page, "A")).toContainText(/Bar \d+/);
  await page.screenshot({ path: "test-results/cue.png" });
  await page.getByRole("button", { name: "Stop listening, Deck A" }).click();

  // During a set, with the preview on the club speakers, Cue on the cued deck is blocked.
  await page.locator("button[aria-busy]").click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/B:Cued/);
  await expect(page.getByRole("button", { name: "Listen, Deck B" })).toBeDisabled();
  expect(errors).toEqual([]);
});

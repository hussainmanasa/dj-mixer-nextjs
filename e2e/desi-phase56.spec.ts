import { expect, test, type Page } from "@playwright/test";
import { DESI_FIXTURE_DIR, FIXTURE_DIR } from "./fixtures";
import { deckStates, loadLibrary } from "./helpers";

const secs = (s: string) => {
  const m = /(\d+):(\d\d)\.(\d)/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10 : NaN;
};

async function openEditor(page: Page, title: string) {
  await page.getByRole("row", { name: new RegExp(title) }).getByRole("button", { name: "Edit" }).click();
  return page.getByRole("dialog");
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

test("suggested hook and dialogue; a far-off opener rewinds into the party", async ({ page }) => {
  const errors = collectErrors(page);
  await loadLibrary(page, [FIXTURE_DIR, DESI_FIXTURE_DIR]);

  const d = await openEditor(page, "Test Ballad 92");
  const hookRow = d.getByText("Hook", { exact: true }).locator("..");
  const dialogueRow = d.getByText("Dialogue", { exact: true }).first().locator("..");
  // The dialogue is the speech at 0.5–5.5 s; the hook is the first chorus (8 bars after the beat starts at 6 s).
  const dialogue = (await dialogueRow.textContent()) ?? "";
  const [dStart, dEnd] = [...dialogue.matchAll(/\d+:\d\d\.\d/g)].map((m) => secs(m[0]));
  expect(dStart).toBeLessThan(1.2);
  expect(dEnd).toBeGreaterThan(4.8);
  expect(dEnd).toBeLessThan(6.5);
  // It leads straight into the beat, so it's a confident suggestion.
  expect(dialogue).toMatch(/[7-9]\d% sure/);
  const hook = (await hookRow.textContent()) ?? "";
  const [hStart] = [...hook.matchAll(/\d+:\d\d\.\d/g)].map((m) => secs(m[0]));
  expect(Math.abs(hStart - (6 + 8 * (240 / 92)))).toBeLessThan(3);
  await d.getByRole("button", { name: "Use the suggested hook" }).click();
  await d.getByRole("button", { name: "Use the suggested dialogue" }).click();
  await expect(d.getByRole("button", { name: "Use the suggested hook" })).toHaveText("In use");
  await page.screenshot({ path: "test-results/suggestions.png" });
  await d.getByLabel("Add to crate").fill("Romantic");
  await d.getByRole("button", { name: "Add", exact: true }).click();
  await d.getByRole("button", { name: "Done" }).click();

  // Desi Night opens with the ballad's hook; 92 BPM can't be beat-matched to the 126–129 party → rewind.
  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: /^Desi Night/ }).click();
  await page.locator("button[aria-busy]").click();
  await expect(page.getByText("Opening with the hook of Test Ballad 92")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Up next").locator("..")).toContainText("Rewind");
  // The hook is 8 bars (~21 s); then the rewind hands over to a party track.
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 60_000 }).toMatch(/B:On air .*Test Groove/);
  await page.click("nav >> text=History");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("table")).toContainText("Rewind");
  expect(errors).toEqual([]);
});

test("a song corrected to half tempo is beat-matched at ×2, not rewound", async ({ page }) => {
  const errors = collectErrors(page);
  await loadLibrary(page, [FIXTURE_DIR, DESI_FIXTURE_DIR]);
  // Detected as 128 (folded into the detector's range); its true tempo is 64.
  const d = await openEditor(page, "Test Slow 64");
  await d.getByRole("button", { name: "÷2" }).click();
  await d.getByRole("button", { name: "Apply grid" }).click();
  await expect(d.getByRole("button", { name: "Apply grid" })).toBeDisabled({ timeout: 30_000 });
  await d.getByLabel("Add to crate").fill("Romantic");
  await d.getByRole("button", { name: "Add", exact: true }).click();
  await d.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("row", { name: /Test Slow 64/ })).toContainText(/6[34]\.\d/);

  // As the opener (64 BPM) its exit to a ~128 party track syncs at ×2: a drop swap, not a rewind.
  await page.click("nav >> text=Booth");
  await page.getByRole("button", { name: /^Desi Night/ }).click();
  await page.locator("button[aria-busy]").click();
  await expect(page.getByText("Opening with the hook of Test Slow 64")).toBeVisible({ timeout: 30_000 });
  const upNext = page.getByText("Up next").locator("..");
  await expect(upNext).toContainText("Drop");
  await expect(upNext).not.toContainText("Rewind");
  // Beat-matched: the incoming party deck runs at roughly 2 × 64 = 128.
  await expect(page.getByRole("region", { name: "Deck B" })).toContainText(/12[6-9]\.\d|130\.\d/);
  expect(errors).toEqual([]);
});

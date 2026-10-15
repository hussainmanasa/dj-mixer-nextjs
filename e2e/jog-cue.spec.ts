import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary, tapAudio } from "./helpers";

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

/** Drag the jog wheel a quarter turn clockwise, slowly enough to be heard. */
async function dragQuarterTurn(page: Page, jog: ReturnType<Page["getByRole"]>, release = true) {
  const box = (await jog.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.width * 0.35;
  await page.mouse.move(cx, cy - r);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    const t = ((Math.PI / 2) * i) / 20;
    await page.mouse.move(cx + r * Math.sin(t), cy - r * Math.cos(t));
    await page.waitForTimeout(15);
  }
  if (release) await page.mouse.up();
}

test("the jog wheel scratches on the club speakers; a playing cue resumes from the new start", async ({ page }) => {
  const taps = await tapAudio(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await loadLibrary(page);
  await page.click("nav >> text=Booth");
  await deck(page, "A").getByRole("button", { name: "Load track" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove C" }).getByRole("button").last().click();
  const jog = page.getByRole("slider", { name: "Start point, Deck A" });
  const chip = () => deck(page, "A").getByText(/^Bar \d+\.\d$/);

  // Cue it (headphones), then drag the wheel: the cue pauses and the scratch plays on the mix's engine.
  await deck(page, "A").getByRole("button", { name: "🎧 Cue" }).click();
  await expect(deck(page, "A").getByRole("button", { name: "■ Stop cue" })).toBeVisible();
  await dragQuarterTurn(page, jog, false);
  await expect(deck(page, "A").getByRole("button", { name: "🎧 Cue" })).toBeVisible();
  await expect.poll(async () => (await taps.get()).scrubPeak).toBeGreaterThan(0.01);
  expect((await taps.get()).scrubHint).toBe("playback");
  // It reaches the speakers through the limiter and master volume.
  expect((await taps.get()).post).toBeGreaterThan(0.01);
  await page.mouse.up();
  await expect(chip()).toHaveText("Bar 2.1");
  // Let go: the scratch ends and the cue carries on from the new start.
  await expect(deck(page, "A").getByRole("button", { name: "■ Stop cue" })).toBeVisible({ timeout: 5000 });
  await expect(deck(page, "A")).toContainText(/cue \d+:\d\d\.\d/);
  expect((await taps.get()).scrubMessages).toEqual(expect.arrayContaining(["window", "target", "end"]));

  // A key step plays a short blip from the new position.
  await deck(page, "A").getByRole("button", { name: "■ Stop cue" }).click();
  await jog.focus();
  await jog.press("ArrowRight");
  await expect.poll(async () => (await taps.get()).scrubMessages.includes("play")).toBe(true);

  // During a set the cued deck scratches too — over the music, on the same speakers (no separate output needed).
  await page.locator("button[aria-busy]").click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/A:On air.*B:Cued/);
  const before = (await taps.get()).scrubMessages.length;
  await dragQuarterTurn(page, page.getByRole("slider", { name: "Start point, Deck B" }));
  await expect.poll(async () => (await taps.get()).scrubMessages.length).toBeGreaterThan(before);
  await expect.poll(async () => (await deckStates(page)).join(" ")).toMatch(/A:On air/);
  expect(errors).toEqual([]);
});

test("separate volumes for the club speakers and the headphones; the club one never trips the silence watchdog", async ({ page }) => {
  const taps = await tapAudio(page);
  await loadLibrary(page);
  await page.click("nav >> text=Booth");
  const club = page.getByRole("slider", { name: "Club speakers volume" });
  const phones = page.getByRole("slider", { name: "Headphones volume" });
  await expect(club).toHaveValue("100");
  await expect(phones).toHaveValue("100");

  // Headphones: a cue at 50% ≈ −12 dB, at 0 silent.
  await deck(page, "A").getByRole("button", { name: "Load track" }).click();
  await page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Test Groove C" }).getByRole("button").last().click();
  await phones.fill("50");
  await deck(page, "A").getByRole("button", { name: "🎧 Cue" }).click();
  await expect(deck(page, "A").getByRole("button", { name: "■ Stop cue" })).toBeVisible();
  await page.waitForTimeout(300);
  await taps.reset();
  await page.waitForTimeout(1500);
  const phonesHalf = await taps.get();
  expect(phonesHalf.previewPre).toBeGreaterThan(0.05);
  expect(phonesHalf.previewPost / phonesHalf.previewPre).toBeGreaterThan(0.2);
  expect(phonesHalf.previewPost / phonesHalf.previewPre).toBeLessThan(0.3);
  await phones.fill("0");
  await page.waitForTimeout(300);
  await taps.reset();
  await page.waitForTimeout(1000);
  const phonesMuted = await taps.get();
  expect(phonesMuted.previewPre).toBeGreaterThan(0.05);
  expect(phonesMuted.previewPost).toBeLessThan(0.001);
  await deck(page, "A").getByRole("button", { name: "■ Stop cue" }).click();

  // Club speakers: the headphones' volume doesn't touch the mix.
  await page.locator("button[aria-busy]").click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/A:On air/);
  await page.waitForTimeout(300);
  await taps.reset();
  await page.waitForTimeout(1500);
  const full = await taps.get();
  expect(full.pre).toBeGreaterThan(0.05);
  expect(full.post / full.pre).toBeGreaterThan(0.9);

  // Half way ≈ −12 dB at the speakers; the level before the volume is unchanged.
  await club.fill("50");
  await page.waitForTimeout(300);
  await taps.reset();
  await page.waitForTimeout(1500);
  const half = await taps.get();
  expect(half.pre).toBeGreaterThan(0.05);
  expect(half.post / half.pre).toBeGreaterThan(0.2);
  expect(half.post / half.pre).toBeLessThan(0.3);

  // At 0 the speakers are silent, the booth warns, and the music keeps playing (no "silence" recovery).
  const onAir = (await deckStates(page)).find((d) => d.startsWith("A:"))!;
  await club.fill("0");
  await expect(page.getByText("Volume is at 0 — the club hears nothing")).toBeVisible();
  await page.waitForTimeout(300);
  await taps.reset();
  await page.waitForTimeout(3500);
  const muted = await taps.get();
  expect(muted.pre).toBeGreaterThan(0.05);
  expect(muted.post).toBeLessThan(0.001);
  expect((await deckStates(page)).find((d) => d.startsWith("A:"))!.split(" ").at(-1)).toBe(onAir.split(" ").at(-1));

  // Both are saved, and the Library's Audio outputs shows the same two sliders.
  await club.fill("80");
  await phones.fill("30");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole("slider", { name: "Club speakers volume" })).toHaveValue("80");
  await expect(page.getByRole("slider", { name: "Headphones volume" })).toHaveValue("30");
  await page.click("nav >> text=Library");
  await expect(page.getByRole("slider", { name: "Club speakers volume" })).toHaveValue("80");
  await expect(page.getByRole("slider", { name: "Headphones volume" })).toHaveValue("30");
});

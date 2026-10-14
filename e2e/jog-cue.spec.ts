import { expect, test, type Page } from "@playwright/test";
import { deckStates, dropButton, loadLibrary } from "./helpers";

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

/**
 * Measure the audio: which AudioContext the scratch worklet runs on (the engine's is created with
 * latencyHint "playback", the preview player's with "interactive"), how loud the scratch is, and
 * the engine's level before the master volume (the watchdog's analyser) and at the speakers.
 */
async function tapAudio(page: Page) {
  await page.addInitScript(() => {
    type Taps = { scrubPeak: number; scrubHint: string; scrubMessages: string[]; pre: number; post: number };
    const w = window as unknown as { taps: Taps };
    w.taps = { scrubPeak: 0, scrubHint: "", scrubMessages: [], pre: 0, post: 0 };
    const hints = new WeakMap<BaseAudioContext, string>();
    const NativeCtx = AudioContext;
    window.AudioContext = class extends NativeCtx {
      constructor(opts?: AudioContextOptions) {
        super(opts);
        hints.set(this, String(opts?.latencyHint ?? ""));
      }
    } as typeof AudioContext;
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...args: unknown[]) => unknown;
    // Taps are connected with the unpatched connect, once per node (an analyser tapping an analyser would recurse).
    const tapped = new WeakSet<AudioNode>();
    const watch = (ctx: BaseAudioContext, node: AudioNode, key: "scrubPeak" | "pre" | "post") => {
      if (tapped.has(node)) return;
      tapped.add(node);
      const an = new AnalyserNode(ctx, { fftSize: 2048 });
      connect.call(node, an);
      const buf = new Float32Array(an.fftSize);
      setInterval(() => {
        an.getFloatTimeDomainData(buf);
        for (const x of buf) w.taps[key] = Math.max(w.taps[key], Math.abs(x));
      }, 20);
    };
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      const dest = args[0];
      if (hints.get(this.context) === "playback") {
        // The watchdog's analyser feeds the master volume; the volume feeds the speakers.
        if (this instanceof AnalyserNode && this.fftSize === 32768) watch(this.context, this, "pre");
        if (dest === this.context.destination) watch(this.context, this, "post");
      }
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
    const NativeWorklet = AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(ctx: BaseAudioContext, name: string, opts?: AudioWorkletNodeOptions) {
        super(ctx, name, opts);
        if (name !== "scrub") return;
        w.taps.scrubHint = hints.get(ctx) ?? "";
        const post = this.port.postMessage.bind(this.port) as (m: unknown, t?: Transferable[]) => void;
        this.port.postMessage = ((m: { type: string }, t?: Transferable[]) => {
          w.taps.scrubMessages.push(m.type);
          post(m, t);
        }) as typeof this.port.postMessage;
        watch(ctx, this, "scrubPeak");
      }
    } as typeof AudioWorkletNode;
  });
  return {
    get: () => page.evaluate(() => (window as unknown as { taps: { scrubPeak: number; scrubHint: string; scrubMessages: string[]; pre: number; post: number } }).taps),
    reset: () =>
      page.evaluate(() => {
        const t = (window as unknown as { taps: { scrubPeak: number; pre: number; post: number } }).taps;
        t.scrubPeak = t.pre = t.post = 0;
      }),
  };
}

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

test("master volume turns the club speakers down without tripping the silence watchdog", async ({ page }) => {
  const taps = await tapAudio(page);
  await loadLibrary(page);
  await page.click("nav >> text=Booth");
  const volume = page.getByRole("slider", { name: "Volume" });
  await expect(volume).toHaveValue("100");
  await page.locator("button[aria-busy]").click();
  await expect.poll(async () => (await deckStates(page)).join(" "), { timeout: 30_000 }).toMatch(/A:On air/);

  // Half way ≈ −12 dB at the speakers; the level before the volume is unchanged.
  await volume.fill("50");
  await page.waitForTimeout(300);
  await taps.reset();
  await page.waitForTimeout(1500);
  const half = await taps.get();
  expect(half.pre).toBeGreaterThan(0.05);
  expect(half.post / half.pre).toBeGreaterThan(0.2);
  expect(half.post / half.pre).toBeLessThan(0.3);

  // At 0 the speakers are silent, the booth warns, and the music keeps playing (no "silence" recovery).
  const onAir = (await deckStates(page)).find((d) => d.startsWith("A:"))!;
  await volume.fill("0");
  await expect(page.getByText("Volume is at 0 — the club hears nothing")).toBeVisible();
  await page.waitForTimeout(300);
  await taps.reset();
  await page.waitForTimeout(3500);
  const muted = await taps.get();
  expect(muted.pre).toBeGreaterThan(0.05);
  expect(muted.post).toBeLessThan(0.001);
  expect((await deckStates(page)).find((d) => d.startsWith("A:"))!.split(" ").at(-1)).toBe(onAir.split(" ").at(-1));

  // It is saved: after a reload the slider is where it was left.
  await volume.fill("80");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole("slider", { name: "Volume" })).toHaveValue("80");
});

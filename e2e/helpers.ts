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
      const state = t.match(/(On air|Paused|Scratch|Cued|Mixing in|Mixing out|Standby|Empty)/)?.[0] ?? "";
      return `${e.getAttribute("aria-label")?.slice(-1)}:${state} ${t.match(/\d+:\d\d \/ −\d+:\d\d/)?.[0] ?? ""} ${t.match(/Test Groove \w/)?.[0] ?? ""}`;
    }),
  );
}

/**
 * Measure the audio: which AudioContext the scratch worklet runs on (the engine's is created with
 * latencyHint "playback", the preview player's with "interactive"), how loud the scratch is, and
 * the engine's level before the master volume (the watchdog's analyser) and at the speakers.
 */
export async function tapAudio(page: Page) {
  await page.addInitScript(() => {
    type Taps = {
      scrubPeak: number;
      scrubHint: string;
      scrubMessages: string[];
      pre: number;
      post: number;
      previewPre: number;
      previewPost: number;
      worklets: string[];
    };
    const w = window as unknown as { taps: Taps };
    w.taps = { scrubPeak: 0, scrubHint: "", scrubMessages: [], pre: 0, post: 0, previewPre: 0, previewPost: 0, worklets: [] };
    // The preview player's volume gain (the node it connects to its speakers).
    const previewOut = new WeakSet<AudioNode>();
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
    const watch = (ctx: BaseAudioContext, node: AudioNode, key: "scrubPeak" | "pre" | "post" | "previewPre" | "previewPost") => {
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
      if (hints.get(this.context) === "interactive") {
        // Each preview sound feeds the volume gain; the volume gain feeds the headphones.
        if (dest === this.context.destination) {
          previewOut.add(this);
          watch(this.context, this, "previewPost");
        } else if (previewOut.has(dest as AudioNode) && this instanceof GainNode) watch(this.context, this, "previewPre");
      }
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
    const NativeWorklet = AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(ctx: BaseAudioContext, name: string, opts?: AudioWorkletNodeOptions) {
        super(ctx, name, opts);
        w.taps.worklets.push(name);
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
    get: () =>
      page.evaluate(
        () =>
          (window as unknown as {
            taps: {
              scrubPeak: number;
              scrubHint: string;
              scrubMessages: string[];
              pre: number;
              post: number;
              previewPre: number;
              previewPost: number;
              worklets: string[];
            };
          }).taps,
      ),
    reset: () =>
      page.evaluate(() => {
        const t = (window as unknown as { taps: { scrubPeak: number; pre: number; post: number; previewPre: number; previewPost: number } }).taps;
        t.scrubPeak = t.pre = t.post = t.previewPre = t.previewPost = 0;
      }),
  };
}

import { expect, test } from "@playwright/test";

// The key-lock worklet running inside Chrome (the DSP itself is unit-tested in lib/audio/keylock.test.ts).
test("key-lock worklet loads and restores the original pitch in the browser", async ({ page }) => {
  await page.goto("/library");
  const result = await page.evaluate(async () => {
    const sr = 44100;
    const ctx = new OfflineAudioContext(2, sr * 2, sr);
    await ctx.audioWorklet.addModule("/worklets/keylock.js");
    const node = new AudioWorkletNode(ctx, "keylock", { outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
    node.parameters.get("pitch")!.value = 1 / 1.05;
    const osc = new OscillatorNode(ctx, { frequency: 440 * 1.05 });
    osc.connect(node).connect(ctx.destination);
    osc.start();
    const out = (await ctx.startRendering()).getChannelData(0);
    const crossings: number[] = [];
    for (let i = sr / 2 + 1; i < out.length; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings.push(i - out[i] / (out[i] - out[i - 1]));
    return ((crossings.length - 1) * sr) / (crossings[crossings.length - 1] - crossings[0]);
  });
  expect(result).toBeCloseTo(440, 0);
});

import { describe, expect, it } from "vitest";
import { cfxFilterOf, channelGainOf, crossfaderGains, eqDbOf, eqKnobOf, faderGainOf, NEUTRAL_CHANNEL, trimDbOf } from "./mixer";

describe("staff mixer", () => {
  it("TRIM is ±12 dB, centre 0", () => {
    expect(trimDbOf(0)).toBe(0);
    expect(trimDbOf(1)).toBe(12);
    expect(trimDbOf(-1)).toBe(-12);
    expect(trimDbOf(5)).toBe(12);
  });

  it("EQ: a −26 dB kill to the left, +6 dB to the right, and back to the knob", () => {
    expect(eqDbOf(0)).toBe(0);
    expect(eqDbOf(-1)).toBe(-26);
    expect(eqDbOf(1)).toBe(6);
    expect(eqDbOf(-0.5)).toBe(-13);
    for (const v of [-1, -0.3, 0, 0.4, 1]) expect(eqKnobOf(eqDbOf(v))).toBeCloseTo(v, 9);
  });

  it("CFX: off in the centre, low-pass closing to the left, high-pass opening to the right", () => {
    expect(cfxFilterOf(0)).toEqual({ type: "lowpass", frequency: 22050, q: 0.7 });
    expect(cfxFilterOf(0.01).frequency).toBe(22050);
    const lp = cfxFilterOf(-1);
    expect(lp.type).toBe("lowpass");
    expect(lp.frequency).toBeCloseTo(150, 6);
    expect(cfxFilterOf(-0.5).frequency).toBeLessThan(cfxFilterOf(-0.2).frequency);
    const hp = cfxFilterOf(1);
    expect(hp.type).toBe("highpass");
    expect(hp.frequency).toBeCloseTo(6000, 6);
    expect(cfxFilterOf(0.5).frequency).toBeGreaterThan(cfxFilterOf(0.2).frequency);
  });

  it("channel fader: a squared taper, 0 is silent", () => {
    expect(faderGainOf(1)).toBe(1);
    expect(faderGainOf(0.5)).toBeCloseTo(0.25, 9);
    expect(faderGainOf(0)).toBe(0);
  });

  it("crossfader: both full in the centre, each end cuts the other channel", () => {
    expect(crossfaderGains(0.5)).toEqual([1, 1]);
    expect(crossfaderGains(0)).toEqual([1, 0]);
    expect(crossfaderGains(1)).toEqual([0, 1]);
    expect(crossfaderGains(0.25)).toEqual([1, 0.5]);
  });

  it("a channel's staff gain: fader × its side of the crossfader (decks C / D aren't on it)", () => {
    expect(channelGainOf(NEUTRAL_CHANNEL, 0.5, 0)).toBe(1);
    expect(channelGainOf(NEUTRAL_CHANNEL, 1, 0)).toBe(0);
    expect(channelGainOf({ ...NEUTRAL_CHANNEL, fader: 0 }, 0.5, 1)).toBe(0);
    expect(channelGainOf(NEUTRAL_CHANNEL, 1, null)).toBe(1);
  });
});

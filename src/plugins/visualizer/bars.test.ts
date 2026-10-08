import { describe, expect, it } from "vitest";
import { barLevels } from "./bars";

// 2048 bins up to 96 kHz, as with the app's audio chain: about 47 Hz per bin.
const SAMPLE_RATE = 192000;
const spectrumWith = (hz: number, value: number): Uint8Array => {
  const spectrum = new Uint8Array(2048);
  spectrum[Math.round(hz / (SAMPLE_RATE / 2 / spectrum.length))] = value;
  return spectrum;
};

describe("barLevels", () => {
  it("gives one level per bar, between 0 and 1", () => {
    const levels = barLevels(new Uint8Array(2048).fill(255), SAMPLE_RATE, 48);
    expect(levels).toHaveLength(48);
    expect(levels.every((level) => level === 1)).toBe(true);
    expect(barLevels(new Uint8Array(2048), SAMPLE_RATE, 48).every((level) => level === 0)).toBe(true);
  });

  it("puts low tones on the left and high tones on the right", () => {
    const low = barLevels(spectrumWith(100, 200), SAMPLE_RATE, 48);
    const high = barLevels(spectrumWith(8000, 200), SAMPLE_RATE, 48);
    const peak = (levels: number[]): number => levels.indexOf(Math.max(...levels));
    expect(peak(low)).toBeLessThan(12);
    expect(peak(high)).toBeGreaterThan(36);
    expect(Math.max(...low)).toBeCloseTo(200 / 255);
  });

  it("ignores what lies beyond the audible range", () => {
    expect(barLevels(spectrumWith(40000, 255), SAMPLE_RATE, 48).every((level) => level === 0)).toBe(true);
  });

  it("copes with a spectrum coarser than the bars", () => {
    const levels = barLevels(new Uint8Array(16).fill(128), 48000, 48);
    expect(levels).toHaveLength(48);
    expect(levels.every((level) => Number.isFinite(level))).toBe(true);
  });
});

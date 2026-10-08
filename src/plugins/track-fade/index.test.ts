import { describe, expect, it } from "vitest";
import { fadeGain } from "./index";

describe("fadeGain", () => {
  const gain = (position: number) => fadeGain(position, 200, 2, 4);

  it("is full volume in the middle of a track", () => {
    expect(gain(2)).toBe(1);
    expect(gain(100)).toBe(1);
    expect(gain(196)).toBe(1);
  });

  it("rises from silence at the start", () => {
    expect(gain(0)).toBe(0);
    expect(gain(1)).toBeCloseTo(0.25);
    expect(gain(0.5)).toBeLessThan(gain(1));
  });

  it("falls to silence at the end", () => {
    expect(gain(198)).toBeCloseTo(0.25);
    expect(gain(200)).toBe(0);
    expect(gain(199)).toBeLessThan(gain(198));
    expect(gain(205)).toBe(0);
  });

  it("can fade only in or only out", () => {
    expect(fadeGain(0, 200, 0, 4)).toBe(1);
    expect(fadeGain(200, 200, 2, 0)).toBe(1);
    expect(fadeGain(0, 200, 0, 0)).toBe(1);
  });

  it("leaves tracks alone whose length is unknown or too short for the fades", () => {
    expect(fadeGain(0, null, 2, 4)).toBe(1);
    expect(fadeGain(0, 0, 2, 4)).toBe(1);
    expect(fadeGain(0, Number.NaN, 2, 4)).toBe(1);
    expect(fadeGain(0, 11, 2, 4)).toBe(1);
    expect(fadeGain(0, 12, 2, 4)).toBe(0);
  });
});

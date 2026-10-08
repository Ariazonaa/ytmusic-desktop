import { describe, expect, it } from "vitest";
import { MAX_SLOPE, fadeCurves, rateFor, slopeFor, tailSeconds, targetDelay } from "./plan";

describe("targetDelay", () => {
  it("is the configured crossfade for ordinary tracks", () => {
    expect(targetDelay(5, 200)).toBe(5);
  });

  it("shrinks for short tracks and is zero for unknown lengths", () => {
    expect(targetDelay(8, 20)).toBe(5);
    expect(targetDelay(5, null)).toBe(0);
    expect(targetDelay(5, 0)).toBe(0);
    expect(targetDelay(-1, 200)).toBe(0);
  });
});

describe("slopeFor", () => {
  /** Simulates the rest of a track at a fixed slope and returns the delay at its end. */
  const delayAtEnd = (slope: number, delay: number, remaining: number): number =>
    delay + slope * (remaining / rateFor(slope));

  it("reaches the target exactly at the end of the track", () => {
    for (const [target, delay, remaining] of [
      [5, 0, 200],
      [5, 2, 60],
      [8, 0, 400],
      [3, 1, 30],
    ] as const) {
      const slope = slopeFor(target, delay, remaining);
      expect(delayAtEnd(slope, delay, remaining)).toBeCloseTo(target, 6);
    }
  });

  it("stays small for a normal track", () => {
    // 5 s over a 200 s track: the player runs about 2.6 % fast.
    expect(slopeFor(5, 0, 200)).toBeCloseTo(0.0257, 3);
  });

  it("is capped when the track ends too soon to get there", () => {
    expect(slopeFor(5, 0, 20)).toBe(MAX_SLOPE);
    expect(slopeFor(5, 0, 12)).toBe(MAX_SLOPE);
    expect(delayAtEnd(MAX_SLOPE, 0, 20)).toBeLessThan(5);
  });

  it("is zero when there is nothing to do", () => {
    expect(slopeFor(5, 5, 100)).toBe(0);
    expect(slopeFor(5, 7, 100)).toBe(0);
    expect(slopeFor(5, 0, 0.5)).toBe(0);
    expect(slopeFor(0, 0, 100)).toBe(0);
  });
});

describe("rateFor", () => {
  it("cancels the slowdown of the growing delay", () => {
    for (const slope of [0, 0.01, 0.0257, MAX_SLOPE]) {
      expect(rateFor(slope) * (1 - slope)).toBeCloseTo(1, 12);
    }
    expect(rateFor(0)).toBe(1);
  });
});

describe("tailSeconds", () => {
  it("is the delay stretched by the same factor", () => {
    expect(tailSeconds(5, 0)).toBe(5);
    expect(tailSeconds(5, 0.02)).toBeCloseTo(5.102, 3);
    expect(tailSeconds(0, 0.05)).toBe(0);
  });
});

describe("fadeCurves", () => {
  it("start and end at the right levels", () => {
    const curves = fadeCurves(32);
    expect(curves.out[0]).toBe(1);
    expect(curves.in[0]).toBe(0);
    expect(curves.out[31]).toBeCloseTo(0, 6);
    expect(curves.in[31]).toBeCloseTo(1, 6);
  });

  it("keep the combined power constant", () => {
    const curves = fadeCurves(64);
    for (let i = 0; i < 64; i++) {
      expect((curves.out[i] ?? 0) ** 2 + (curves.in[i] ?? 0) ** 2).toBeCloseTo(1, 6);
    }
  });
});

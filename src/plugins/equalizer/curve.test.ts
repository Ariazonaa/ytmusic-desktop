import { describe, expect, it } from "vitest";
import { GRAPH, curvePath, graphFrequencies, magnitudeToDb, xFor, yFor } from "./curve";

describe("graph geometry", () => {
  it("spreads frequencies logarithmically from 20 Hz to 20 kHz", () => {
    const frequencies = graphFrequencies(4);
    expect([...frequencies].map(Math.round)).toEqual([20, 200, 2000, 20000]);
  });

  it("maps frequency to x on a logarithmic scale", () => {
    expect(xFor(20)).toBe(0);
    expect(xFor(20000)).toBe(GRAPH.width);
    // 632 Hz is the geometric middle of 20 Hz and 20 kHz.
    expect(xFor(Math.sqrt(20 * 20000))).toBeCloseTo(GRAPH.width / 2);
    expect(xFor(5)).toBe(0);
    expect(xFor(99999)).toBe(GRAPH.width);
  });

  it("maps gain to y with 0 dB in the middle and louder upwards", () => {
    expect(yFor(0)).toBe(GRAPH.height / 2);
    expect(yFor(GRAPH.rangeDb)).toBe(0);
    expect(yFor(-GRAPH.rangeDb)).toBe(GRAPH.height);
    expect(yFor(6)).toBeLessThan(yFor(0));
    expect(yFor(100)).toBe(0);
  });

  it("converts magnitude to decibels", () => {
    expect(magnitudeToDb(1)).toBeCloseTo(0);
    expect(magnitudeToDb(2)).toBeCloseTo(6.02, 2);
    expect(magnitudeToDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(Number.isFinite(magnitudeToDb(0))).toBe(true);
  });

  it("builds a path through the points", () => {
    expect(curvePath([20, 20000], [0, GRAPH.rangeDb])).toBe(`M0.0 60.0 L${GRAPH.width}.0 0.0`);
    expect(curvePath([], [])).toBe("");
  });
});

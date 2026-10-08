import { describe, expect, it } from "vitest";
import { RATIO, THRESHOLD_DB, makeupDb } from "./index";

describe("makeupDb", () => {
  it("is what the browser's compressor adds for these settings", () => {
    // A full-scale signal comes out at -1.5 + 1.5 / 20 = -1.425 dB; 0.6 of that is added back.
    expect(makeupDb(THRESHOLD_DB, RATIO)).toBeCloseTo(0.855, 3);
  });

  it("is nothing for a compressor that does nothing", () => {
    expect(makeupDb(0, 20)).toBeCloseTo(0);
    expect(makeupDb(-24, 1)).toBeCloseTo(0);
  });
});

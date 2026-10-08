import { describe, expect, it } from "vitest";
import { MAX_REMEMBERED, describeOffset, parseOffsets, withOffset } from "./offsets";

describe("parseOffsets", () => {
  it("reads corrections by video id", () => {
    expect([...parseOffsets('{"dQw4w9WgXcQ":1.5,"lYBUbBu4W08":-0.5}')]).toEqual([
      ["dQw4w9WgXcQ", 1.5],
      ["lYBUbBu4W08", -0.5],
    ]);
  });

  it("drops what is not a correction and keeps the rest in range", () => {
    const text = JSON.stringify({ dQw4w9WgXcQ: 99, lYBUbBu4W08: "2", "no id": 1, abcdefgh: 0, ijklmnop: -40.04 });
    expect([...parseOffsets(text)]).toEqual([
      ["dQw4w9WgXcQ", 15],
      ["ijklmnop", -15],
    ]);
  });

  it("starts empty for a missing or damaged setting", () => {
    for (const setting of [undefined, "", "{ nope", "[1]", "null", 5]) {
      expect(parseOffsets(setting).size, String(setting)).toBe(0);
    }
  });
});

describe("withOffset", () => {
  it("sets, changes and forgets a track's correction", () => {
    const one = withOffset(new Map(), "dQw4w9WgXcQ", 0.5);
    expect(one).toBe('{"dQw4w9WgXcQ":0.5}');
    const two = withOffset(parseOffsets(one), "dQw4w9WgXcQ", 1);
    expect(two).toBe('{"dQw4w9WgXcQ":1}');
    expect(withOffset(parseOffsets(two), "dQw4w9WgXcQ", 0)).toBe("{}");
  });

  it("forgets the tracks corrected longest ago", () => {
    let text = "{}";
    for (let i = 0; i < MAX_REMEMBERED + 5; i++) text = withOffset(parseOffsets(text), `track-${String(i).padStart(4, "0")}`, 1);
    const offsets = parseOffsets(text);
    expect(offsets.size).toBe(MAX_REMEMBERED);
    expect(offsets.has("track-0000")).toBe(false);
    expect(offsets.has("track-0005")).toBe(true);
    // Correcting an old one again makes it the newest.
    const again = parseOffsets(withOffset(offsets, "track-0005", 2));
    expect([...again.keys()].at(-1)).toBe("track-0005");
  });
});

describe("describeOffset", () => {
  it("shows the sign", () => {
    expect(describeOffset(0)).toBe("0 s");
    expect(describeOffset(1.5)).toBe("+1.5 s");
    expect(describeOffset(-0.5)).toBe("−0.5 s");
  });
});

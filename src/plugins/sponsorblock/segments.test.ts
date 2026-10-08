import { describe, expect, it } from "vitest";
import { enabledCategories, formatDuration, parseSegments, segmentAt, segmentsUrl, type Segment } from "./segments";

describe("formatDuration", () => {
  it("reads as seconds, minutes or hours", () => {
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(14.4)).toBe("14 s");
    expect(formatDuration(59.6)).toBe("1 min");
    expect(formatDuration(725)).toBe("12 min");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(11100)).toBe("3 h 5 min");
    expect(formatDuration(-5)).toBe("0 s");
  });
});

const response = [
  {
    videoID: "other",
    segments: [{ UUID: "x", category: "sponsor", actionType: "skip", segment: [1, 2] }],
  },
  {
    videoID: "abc",
    segments: [
      { UUID: "late", category: "outro", actionType: "skip", segment: [200, 213] },
      { UUID: "early", category: "music_offtopic", actionType: "skip", segment: [0, 12.5] },
      { UUID: "mute", category: "sponsor", actionType: "mute", segment: [30, 40] },
      { UUID: "backwards", category: "sponsor", actionType: "skip", segment: [50, 40] },
      { UUID: "broken", category: "sponsor", actionType: "skip", segment: ["a", "b"] },
      "garbage",
    ],
  },
];

describe("parseSegments", () => {
  it("returns the skip segments of the requested video, sorted by start", () => {
    expect(parseSegments(response, "abc")).toEqual([
      { id: "early", category: "music_offtopic", start: 0, end: 12.5 },
      { id: "late", category: "outro", start: 200, end: 213 },
    ]);
  });

  it("returns nothing for unknown videos and malformed data", () => {
    expect(parseSegments(response, "missing")).toEqual([]);
    expect(parseSegments(null, "abc")).toEqual([]);
    expect(parseSegments({ videoID: "abc" }, "abc")).toEqual([]);
    expect(parseSegments([{ videoID: "abc" }], "abc")).toEqual([]);
  });
});

describe("segmentAt", () => {
  const segments: Segment[] = [
    { id: "a", category: "music_offtopic", start: 0, end: 10 },
    { id: "b", category: "outro", start: 200, end: 213 },
  ];
  const all = new Set(["music_offtopic", "outro"]);

  it("finds the segment containing the position", () => {
    expect(segmentAt(segments, 5, all, new Set())?.id).toBe("a");
    expect(segmentAt(segments, 200, all, new Set())?.id).toBe("b");
  });

  it("finds nothing outside segments, the end being exclusive", () => {
    expect(segmentAt(segments, 10, all, new Set())).toBeUndefined();
    expect(segmentAt(segments, 100, all, new Set())).toBeUndefined();
  });

  it("ignores disabled categories and segments already skipped", () => {
    expect(segmentAt(segments, 5, new Set(["outro"]), new Set())).toBeUndefined();
    expect(segmentAt(segments, 5, all, new Set(["a"]))).toBeUndefined();
  });
});

describe("enabledCategories", () => {
  it("maps the switched-on settings to SponsorBlock categories", () => {
    const settings = { musicOfftopic: true, sponsor: false, outro: true, showNotice: true };
    expect(enabledCategories(settings)).toEqual(new Set(["music_offtopic", "outro"]));
  });
});

describe("segmentsUrl", () => {
  it("asks by hash prefix, not by video id", async () => {
    const url = await segmentsUrl("dQw4w9WgXcQ");
    // SHA-256("dQw4w9WgXcQ") starts with 4e7d.
    expect(url).toMatch(/^https:\/\/sponsor\.ajay\.app\/api\/skipSegments\/[0-9a-f]{4}\?categories=/);
    expect(url).not.toContain("dQw4w9WgXcQ");
    expect(decodeURIComponent(url)).toContain('"music_offtopic"');
  });
});

import { describe, expect, it } from "vitest";
import { activeLineIndex, cleanTitle, parseLrc, pickLyrics, searchUrl } from "./lrc";

describe("parseLrc", () => {
  it("parses timestamps and text", () => {
    expect(parseLrc("[00:12.50] First line\n[01:02.03]Second line")).toEqual([
      { time: 12.5, text: "First line" },
      { time: 62.03, text: "Second line" },
    ]);
  });

  it("expands lines with several timestamps and sorts by time", () => {
    expect(parseLrc("[00:30.00][00:10.00]Chorus\n[00:20.00]Verse")).toEqual([
      { time: 10, text: "Chorus" },
      { time: 20, text: "Verse" },
      { time: 30, text: "Chorus" },
    ]);
  });

  it("keeps instrumental gaps and skips metadata and plain lines", () => {
    expect(parseLrc("[ar:Artist]\nno timestamp\r\n[00:05.00]\n[00:07:50]Colon style")).toEqual([
      { time: 5, text: "" },
      { time: 7.5, text: "Colon style" },
    ]);
  });
});

describe("activeLineIndex", () => {
  const lines = [
    { time: 5, text: "a" },
    { time: 10, text: "b" },
    { time: 15, text: "c" },
  ];

  it("is -1 before the first line", () => {
    expect(activeLineIndex(lines, 4.9)).toBe(-1);
    expect(activeLineIndex([], 10)).toBe(-1);
  });

  it("is the last line that has started", () => {
    expect(activeLineIndex(lines, 5)).toBe(0);
    expect(activeLineIndex(lines, 12)).toBe(1);
    expect(activeLineIndex(lines, 999)).toBe(2);
  });
});

describe("cleanTitle", () => {
  it("drops video and remaster additions", () => {
    expect(cleanTitle("Never Gonna Give You Up (Official Video)")).toBe("Never Gonna Give You Up");
    expect(cleanTitle("Together Forever (2022 Remaster)")).toBe("Together Forever");
    expect(cleanTitle("Song [Official Audio] (Lyrics)")).toBe("Song");
  });

  it("keeps meaningful brackets and never returns an empty title", () => {
    expect(cleanTitle("Song (feat. Someone)")).toBe("Song (feat. Someone)");
    expect(cleanTitle("(Official Video)")).toBe("(Official Video)");
  });
});

describe("searchUrl", () => {
  it("encodes the cleaned title and the artist", () => {
    expect(searchUrl("A & B (Official Video)", "X/Y")).toBe(
      "https://lrclib.net/api/search?track_name=A+%26+B&artist_name=X%2FY",
    );
  });
});

describe("pickLyrics", () => {
  const full = "[00:01.00]one\n[00:02.00]two\n[00:03.00]three";

  it("prefers the entry with the most synced lines among matching durations", () => {
    const results = [
      { duration: 213, syncedLyrics: "[00:00.00]probe", plainLyrics: "probe" },
      { duration: 212, syncedLyrics: full, plainLyrics: "one\ntwo\nthree" },
      { duration: 300, syncedLyrics: `${full}\n[00:04.00]four\n[00:05.00]five`, plainLyrics: "x" },
    ];
    const lyrics = pickLyrics(results, 213.1);
    expect(lyrics?.synced).toHaveLength(3);
    expect(lyrics?.plain).toBe("one\ntwo\nthree");
  });

  it("falls back to plain lyrics", () => {
    const results = [{ duration: 100, syncedLyrics: null, plainLyrics: " just text \n" }];
    expect(pickLyrics(results, 100)).toEqual({ synced: null, plain: "just text" });
  });

  it("accepts any duration while the track length is unknown", () => {
    expect(pickLyrics([{ duration: 300, syncedLyrics: full }], null)?.synced).toHaveLength(3);
  });

  it("returns null without usable results", () => {
    expect(pickLyrics([], 100)).toBeNull();
    expect(pickLyrics(null, 100)).toBeNull();
    expect(pickLyrics([{ duration: 500, syncedLyrics: full }], 100)).toBeNull();
    expect(pickLyrics([{ duration: 100, instrumental: true }, "junk"], 100)).toBeNull();
  });
});

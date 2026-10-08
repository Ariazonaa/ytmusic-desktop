import { describe, expect, it, vi } from "vitest";
import type { JsonResponse, Song } from "../../shared/types";
import { findLyrics, freeTextUrl, lyricsOvhUrl, parseLyricsOvh, primaryArtist } from "./sources";

const song: Song = { title: "Song (Official Video)", artist: "A, B & C", album: "", artworkUrl: null };
const synced = "[00:01.00]one\n[00:02.00]two\n[00:03.00]three";
const lrclibSynced = [{ duration: 100, syncedLyrics: synced, plainLyrics: "one\ntwo\nthree" }];
const lrclibPlain = [{ duration: 100, syncedLyrics: null, plainLyrics: "plain from lrclib" }];

/** Answers requests by URL part; unlisted URLs get a 404. */
function fakeGetJson(routes: Record<string, JsonResponse | Error>) {
  return vi.fn((url: string): Promise<JsonResponse> => {
    const match = Object.entries(routes).find(([part]) => url.includes(part));
    if (!match) return Promise.resolve({ status: 404, data: null });
    return match[1] instanceof Error ? Promise.reject(match[1]) : Promise.resolve(match[1]);
  });
}
const duration = (): number => 100;

describe("primaryArtist", () => {
  it.each([
    ["A, B & C", "A"],
    ["A & B", "A"],
    ["A feat. B", "A"],
    ["A ft B", "A"],
    ["A x B", "A"],
    ["Rick Astley", "Rick Astley"],
    ["Axel Fox", "Axel Fox"],
  ])("%s -> %s", (artist, expected) => {
    expect(primaryArtist(artist)).toBe(expected);
  });
});

describe("URLs", () => {
  it("builds the free-text search from clean title and first artist", () => {
    expect(freeTextUrl(song.title, song.artist)).toBe("https://lrclib.net/api/search?q=Song+A");
  });

  it("encodes the lyrics.ovh path", () => {
    expect(lyricsOvhUrl("AC/DC Song?", "Guns N' Roses")).toBe(
      "https://api.lyrics.ovh/v1/Guns%20N'%20Roses/AC%20DC%20Song%3F",
    );
  });
});

describe("parseLyricsOvh", () => {
  it("returns plain lyrics without the credit line and extra blank lines", () => {
    const data = { lyrics: "Paroles de la chanson Song par A\r\nline one\r\n\r\n\r\n\r\nline two\n" };
    expect(parseLyricsOvh(data)).toEqual({ synced: null, plain: "line one\n\nline two" });
  });

  it("returns null without lyrics", () => {
    expect(parseLyricsOvh({ lyrics: "  " })).toBeNull();
    expect(parseLyricsOvh({ error: "No lyrics found" })).toBeNull();
    expect(parseLyricsOvh(null)).toBeNull();
  });
});

describe("findLyrics", () => {
  it("stops at the first source with synced lyrics", async () => {
    const getJson = fakeGetJson({ "track_name=": { status: 200, data: lrclibSynced } });
    const found = await findLyrics(getJson, song, duration);
    expect(found?.source).toBe("LRCLIB");
    expect(found?.lyrics.synced).toHaveLength(3);
    expect(getJson).toHaveBeenCalledOnce();
  });

  it("tries the free-text search when the first search has nothing", async () => {
    const getJson = fakeGetJson({
      "track_name=": { status: 200, data: [] },
      "?q=": { status: 200, data: lrclibSynced },
    });
    expect((await findLyrics(getJson, song, duration))?.lyrics.synced).toHaveLength(3);
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it("prefers later synced lyrics over earlier plain ones", async () => {
    const getJson = fakeGetJson({
      "track_name=": { status: 200, data: lrclibPlain },
      "?q=": { status: 200, data: lrclibSynced },
    });
    expect((await findLyrics(getJson, song, duration))?.lyrics.synced).toHaveLength(3);
  });

  it("falls back to lyrics.ovh", async () => {
    const getJson = fakeGetJson({ "lyrics.ovh": { status: 200, data: { lyrics: "from ovh" } } });
    expect(await findLyrics(getJson, song, duration)).toEqual({
      lyrics: { synced: null, plain: "from ovh" },
      source: "lyrics.ovh",
    });
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it("keeps the first plain lyrics when nothing is synced", async () => {
    const getJson = fakeGetJson({
      "track_name=": { status: 200, data: lrclibPlain },
      "lyrics.ovh": { status: 200, data: { lyrics: "from ovh" } },
    });
    const found = await findLyrics(getJson, song, duration);
    expect(found).toEqual({ lyrics: { synced: null, plain: "plain from lrclib" }, source: "LRCLIB" });
  });

  it("skips a failing source", async () => {
    const getJson = fakeGetJson({
      "lrclib.net": new Error("offline"),
      "lyrics.ovh": { status: 200, data: { lyrics: "from ovh" } },
    });
    expect((await findLyrics(getJson, song, duration))?.source).toBe("lyrics.ovh");
  });

  it("returns null when no source has lyrics", async () => {
    expect(await findLyrics(fakeGetJson({}), song, duration)).toBeNull();
  });

  it("rejects only when every source failed", async () => {
    const getJson = fakeGetJson({ "lrclib.net": new Error("offline"), "lyrics.ovh": new Error("offline") });
    await expect(findLyrics(getJson, song, duration)).rejects.toThrow("offline");
  });
});

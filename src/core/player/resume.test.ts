import { describe, expect, it } from "vitest";
import { isFreshStart, parseResumePoint, positionToRestore, resumeUrl } from "./resume";

describe("parseResumePoint", () => {
  it("reads a stored point", () => {
    const text = JSON.stringify({ videoId: "dQw4w9WgXcQ", listId: "RDAMVMdQw4w9WgXcQ", positionSeconds: 61.5 });
    expect(parseResumePoint(text)).toEqual({ videoId: "dQw4w9WgXcQ", listId: "RDAMVMdQw4w9WgXcQ", positionSeconds: 61.5 });
  });

  it("drops a list id that is not one, but keeps the track", () => {
    for (const listId of [null, 5, "", "a b", "x&y=1", "../../etc"]) {
      const text = JSON.stringify({ videoId: "dQw4w9WgXcQ", listId, positionSeconds: 3 });
      expect(parseResumePoint(text)).toEqual({ videoId: "dQw4w9WgXcQ", listId: null, positionSeconds: 3 });
    }
  });

  it("ignores everything else", () => {
    for (const text of [
      null,
      "",
      "{ nope",
      "[]",
      "null",
      JSON.stringify({ videoId: "x", positionSeconds: 1 }),
      JSON.stringify({ videoId: "dQw4w9WgXcQ&list=evil", positionSeconds: 1 }),
      JSON.stringify({ videoId: "dQw4w9WgXcQ", positionSeconds: -1 }),
      JSON.stringify({ videoId: "dQw4w9WgXcQ", positionSeconds: "12" }),
      JSON.stringify({ videoId: "dQw4w9WgXcQ" }),
    ]) {
      expect(parseResumePoint(text), String(text)).toBeNull();
    }
  });
});

describe("resumeUrl", () => {
  it("leads to the track, with its list if there was one", () => {
    expect(resumeUrl({ videoId: "dQw4w9WgXcQ", listId: null, positionSeconds: 0 })).toBe("/watch?v=dQw4w9WgXcQ");
    expect(resumeUrl({ videoId: "a-b_c12", listId: "PL123", positionSeconds: 0 })).toBe("/watch?v=a-b_c12&list=PL123");
  });
});

describe("positionToRestore", () => {
  const at = (positionSeconds: number) => ({ videoId: "dQw4w9WgXcQ", listId: null, positionSeconds });

  it("continues where the track was", () => {
    expect(positionToRestore(at(61.7), 213)).toBe(61);
    expect(positionToRestore(at(61.7), null)).toBe(61);
  });

  it("starts over near the end", () => {
    expect(positionToRestore(at(205), 213)).toBe(0);
    expect(positionToRestore(at(500), 213)).toBe(0);
    expect(positionToRestore(at(202), 213)).toBe(202);
  });
});

describe("isFreshStart", () => {
  const session = (started: boolean) => ({ getItem: () => (started ? "1" : null) });

  it("is the first load of the home page", () => {
    expect(isFreshStart({ pathname: "/", search: "" }, session(false))).toBe(true);
  });

  it("is not a later visit or another page", () => {
    expect(isFreshStart({ pathname: "/", search: "" }, session(true))).toBe(false);
    expect(isFreshStart({ pathname: "/watch", search: "?v=abc" }, session(false))).toBe(false);
    expect(isFreshStart({ pathname: "/", search: "?feature=share" }, session(false))).toBe(false);
  });
});

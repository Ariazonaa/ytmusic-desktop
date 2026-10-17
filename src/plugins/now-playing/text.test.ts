import { describe, expect, it } from "vitest";
import { nowPlayingText } from "./text";

const song = { title: "Sugar", artist: "Maroon 5", album: "V", artworkUrl: null };

describe("nowPlayingText", () => {
  it("fills in the track", () => {
    expect(nowPlayingText("{artist} – {title}", song)).toBe("Maroon 5 – Sugar");
    expect(nowPlayingText("♪ {title} ({album})", song)).toBe("♪ Sugar (V)");
  });

  it("leaves other braces alone and says nothing without a track", () => {
    expect(nowPlayingText("{year} {title}", song)).toBe("{year} Sugar");
    expect(nowPlayingText("{title}", null)).toBe("");
  });
});

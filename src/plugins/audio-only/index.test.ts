import { describe, expect, it } from "vitest";
import { VideoChoice } from "./index";

describe("VideoChoice", () => {
  it("holds nothing until the user chooses", () => {
    expect(new VideoChoice().holdsFor("song", true)).toBe(false);
  });

  it("holds while the video loads, for the video, and no longer for the next track", () => {
    const choice = new VideoChoice();
    choice.choose();
    // The page still plays the song and has not switched yet.
    expect(choice.holdsFor("song", false)).toBe(true);
    expect(choice.holdsFor(null, true)).toBe(true);
    // The video has loaded.
    expect(choice.holdsFor("video", true)).toBe(true);
    expect(choice.holdsFor("video", true)).toBe(true);
    // The next track comes up as a video too: that one was not chosen.
    expect(choice.holdsFor("next", true)).toBe(false);
    expect(choice.holdsFor("video", true)).toBe(false);
  });

  it("ends when the user goes back to the song", () => {
    const choice = new VideoChoice();
    choice.choose();
    choice.holdsFor("video", true);
    choice.clear();
    expect(choice.holdsFor("video", true)).toBe(false);
  });
});

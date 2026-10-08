import { afterEach, describe, expect, it, vi } from "vitest";
import { readPlaybackState, readVideoId, watchPlayback } from "./playback";

function addVideo(state: { paused: boolean; currentTime: number; duration: number }) {
  const video = document.createElement("video");
  for (const [key, value] of Object.entries(state)) {
    Object.defineProperty(video, key, { value, configurable: true });
  }
  return document.body.appendChild(video);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("readPlaybackState", () => {
  it("returns null without a video element", () => {
    expect(readPlaybackState()).toBeNull();
  });

  it("reads position, duration and paused", () => {
    addVideo({ paused: false, currentTime: 12.5, duration: 200 });
    expect(readPlaybackState()).toEqual({
      paused: false,
      positionSeconds: 12.5,
      durationSeconds: 200,
    });
  });

  it.each([NaN, Infinity])("reports an unknown duration (%s) as null", (duration) => {
    addVideo({ paused: true, currentTime: 0, duration });
    expect(readPlaybackState()?.durationSeconds).toBeNull();
  });
});

describe("readPlaybackState with the player", () => {
  function addPlayer(api: Record<string, unknown>) {
    const player = document.body.appendChild(document.createElement("div"));
    player.id = "movie_player";
    return Object.assign(player, api);
  }

  it("takes position and length from the player, per track", () => {
    // The element after one track has run into the next: its clock went on.
    addVideo({ paused: false, currentTime: 217, duration: 262.9 });
    addPlayer({
      getCurrentTime: () => 4,
      getPlayerResponse: () => ({ videoDetails: { lengthSeconds: "251" } }),
    });
    expect(readPlaybackState()).toEqual({ paused: false, positionSeconds: 4, durationSeconds: 251 });
  });

  it("falls back to the element for whatever the player does not report", () => {
    addVideo({ paused: true, currentTime: 12, duration: 200 });
    addPlayer({ getCurrentTime: () => Number.NaN, getPlayerResponse: () => ({ videoDetails: {} }) });
    expect(readPlaybackState()).toEqual({ paused: true, positionSeconds: 12, durationSeconds: 200 });
  });

  it("ignores a length of zero", () => {
    addVideo({ paused: true, currentTime: 0, duration: 200 });
    addPlayer({ getPlayerResponse: () => ({ videoDetails: { lengthSeconds: "0" } }) });
    expect(readPlaybackState()?.durationSeconds).toBe(200);
  });
});

describe("readVideoId", () => {
  it("prefers the player's own data", () => {
    const player = document.body.appendChild(document.createElement("div"));
    player.id = "movie_player";
    Object.assign(player, { getVideoData: () => ({ video_id: "abc123" }) });
    expect(readVideoId()).toBe("abc123");
  });

  it("is null without a player and without a v parameter", () => {
    expect(readVideoId()).toBeNull();
  });
});

describe("watchPlayback", () => {
  it("reports play, pause, seek and duration changes of the video", () => {
    const video = addVideo({ paused: true, currentTime: 3, duration: 100 });
    const onChange = vi.fn();
    const stop = watchPlayback(onChange);

    for (const type of ["play", "pause", "seeked", "durationchange"]) {
      video.dispatchEvent(new Event(type));
    }
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(onChange).toHaveBeenLastCalledWith({
      paused: true,
      positionSeconds: 3,
      durationSeconds: 100,
    });

    stop();
    video.dispatchEvent(new Event("play"));
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("ignores other events and other elements", () => {
    const video = addVideo({ paused: true, currentTime: 0, duration: 100 });
    const audio = document.body.appendChild(document.createElement("audio"));
    const onChange = vi.fn();
    const stop = watchPlayback(onChange);

    video.dispatchEvent(new Event("timeupdate"));
    audio.dispatchEvent(new Event("play"));

    expect(onChange).not.toHaveBeenCalled();
    stop();
  });
});

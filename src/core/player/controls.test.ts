import { afterEach, describe, expect, it, vi } from "vitest";
import { controlPlayer, seekTo, setPlaybackRate } from "./controls";

function addVideo(paused: boolean) {
  const video = document.body.appendChild(document.createElement("video"));
  Object.defineProperty(video, "paused", { value: paused });
  video.play = vi.fn(() => Promise.resolve());
  video.pause = vi.fn();
  return video;
}

function addPlayerBarButton(className: string) {
  const bar = document.body.appendChild(document.createElement("ytmusic-player-bar"));
  const button = bar.appendChild(document.createElement("button"));
  button.className = className;
  const onClick = vi.fn();
  button.addEventListener("click", onClick);
  return onClick;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("seekTo", () => {
  it("sets the position, never below zero", () => {
    const video = document.body.appendChild(document.createElement("video"));
    seekTo(42.5);
    expect(video.currentTime).toBe(42.5);
    seekTo(-3);
    expect(video.currentTime).toBe(0);
  });

  it("seeks through the player when it is there", () => {
    const video = document.body.appendChild(document.createElement("video"));
    const player = document.body.appendChild(document.createElement("div"));
    player.id = "movie_player";
    const playerSeek = vi.fn();
    Object.assign(player, { seekTo: playerSeek });

    seekTo(42.5);
    seekTo(-3);

    expect(playerSeek.mock.calls).toEqual([
      [42.5, true],
      [0, true],
    ]);
    expect(video.currentTime).toBe(0);
  });

  it("ignores invalid positions and a missing player", () => {
    expect(() => seekTo(10)).not.toThrow();
    const video = document.body.appendChild(document.createElement("video"));
    seekTo(Number.NaN);
    expect(video.currentTime).toBe(0);
  });
});

describe("setPlaybackRate", () => {
  it("sets speed and pitch handling, within sane limits", () => {
    const video = document.body.appendChild(document.createElement("video"));
    setPlaybackRate(1.5, false);
    expect(video.playbackRate).toBe(1.5);
    expect(video.preservesPitch).toBe(false);
    setPlaybackRate(100, true);
    expect(video.playbackRate).toBe(4);
    setPlaybackRate(0, true);
    expect(video.playbackRate).toBe(0.25);
  });

  it("ignores invalid speeds and a missing player", () => {
    expect(() => setPlaybackRate(2, true)).not.toThrow();
    const video = document.body.appendChild(document.createElement("video"));
    setPlaybackRate(Number.NaN, true);
    expect(video.playbackRate).toBe(1);
  });
});

describe("controlPlayer", () => {
  it("resumes a paused video", () => {
    const video = addVideo(true);
    controlPlayer("playPause");
    expect(video.play).toHaveBeenCalledOnce();
    expect(video.pause).not.toHaveBeenCalled();
  });

  it("pauses a playing video", () => {
    const video = addVideo(false);
    controlPlayer("playPause");
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
  });

  it("clicks the page's next and previous buttons", () => {
    const next = addPlayerBarButton("next-button");
    const previous = addPlayerBarButton("previous-button");
    controlPlayer("next");
    expect(next).toHaveBeenCalledOnce();
    expect(previous).not.toHaveBeenCalled();
    controlPlayer("previous");
    expect(previous).toHaveBeenCalledOnce();
  });

  it("does nothing before the player exists", () => {
    expect(() => {
      controlPlayer("playPause");
      controlPlayer("next");
      controlPlayer("previous");
    }).not.toThrow();
  });
});

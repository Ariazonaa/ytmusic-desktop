import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepOnDesktopControls } from "./desktop-controls";

function video(paused: boolean): HTMLVideoElement {
  const element = document.body.appendChild(document.createElement("video"));
  Object.defineProperty(element, "paused", { value: paused, configurable: true });
  element.play = vi.fn(() => Promise.resolve());
  return element;
}

let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  stop = keepOnDesktopControls();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("keepOnDesktopControls", () => {
  it("plays the video that plays once more, a moment after it started playing", () => {
    const playing = video(false);
    playing.dispatchEvent(new Event("playing"));
    expect(playing.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(playing.play).toHaveBeenCalledOnce();
  });

  it("leaves a video alone that was paused in the meantime", () => {
    const paused = video(true);
    paused.dispatchEvent(new Event("playing"));
    vi.advanceTimersByTime(500);
    expect(paused.play).not.toHaveBeenCalled();
  });

  it("plays it once after several starts in a row", () => {
    const playing = video(false);
    for (let i = 0; i < 3; i++) {
      playing.dispatchEvent(new Event("playing"));
      vi.advanceTimersByTime(200);
    }
    vi.advanceTimersByTime(500);
    expect(playing.play).toHaveBeenCalledOnce();
  });

  it("does nothing once stopped", () => {
    const playing = video(false);
    stop();
    playing.dispatchEvent(new Event("playing"));
    vi.advanceTimersByTime(500);
    expect(playing.play).not.toHaveBeenCalled();
  });
});

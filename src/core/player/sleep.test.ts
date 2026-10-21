import { afterEach, describe, expect, it, vi } from "vitest";
import { SleepAtTrackEnd } from "./sleep";

function video(currentTime: number, duration: number): HTMLVideoElement {
  const element = document.body.appendChild(document.createElement("video"));
  Object.defineProperty(element, "currentTime", { value: currentTime, configurable: true });
  Object.defineProperty(element, "duration", { value: duration, configurable: true });
  element.pause = vi.fn();
  return element;
}

afterEach(() => document.body.replaceChildren());

describe("SleepAtTrackEnd", () => {
  it("pauses just before the end once armed, and only once", () => {
    const done = vi.fn();
    const sleep = new SleepAtTrackEnd(done);
    const early = video(100, 200);
    early.dispatchEvent(new Event("timeupdate"));
    expect(early.pause).not.toHaveBeenCalled();

    sleep.set(true);
    early.dispatchEvent(new Event("timeupdate"));
    expect(early.pause).not.toHaveBeenCalled();

    const late = video(198.6, 200);
    late.dispatchEvent(new Event("timeupdate"));
    expect(late.pause).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
    expect(sleep.isArmed).toBe(false);

    late.dispatchEvent(new Event("timeupdate"));
    expect(done).toHaveBeenCalledOnce();
  });

  it("stops the next track at once if YouTube Music went on before the last moment was seen", () => {
    const done = vi.fn();
    const sleep = new SleepAtTrackEnd(done);
    sleep.set(true);
    // The last report seen is some seconds before the end, then the next track starts.
    video(196, 200).dispatchEvent(new Event("timeupdate"));
    expect(done).not.toHaveBeenCalled();
    const next = video(0.2, 240);
    next.dispatchEvent(new Event("playing"));
    expect(next.pause).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledOnce();
  });

  it("lets a track start that is not after an end, such as one the user picks", () => {
    const done = vi.fn();
    const sleep = new SleepAtTrackEnd(done);
    sleep.set(true);
    video(30, 200).dispatchEvent(new Event("timeupdate"));
    const picked = video(0.1, 240);
    picked.dispatchEvent(new Event("playing"));
    expect(picked.pause).not.toHaveBeenCalled();
    expect(sleep.isArmed).toBe(true);
  });

  it("does nothing while off, or while the length is not known", () => {
    const done = vi.fn();
    const sleep = new SleepAtTrackEnd(done);
    const ending = video(199.8, 200);
    ending.dispatchEvent(new Event("timeupdate"));
    sleep.set(true);
    const unknown = video(10, Number.NaN);
    unknown.dispatchEvent(new Event("timeupdate"));
    expect(done).not.toHaveBeenCalled();
    sleep.set(false);
    ending.dispatchEvent(new Event("ended"));
    expect(done).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaybackState, PluginApi } from "../../shared/types";
import crossfade from "./index";

/** An AudioParam that only remembers where it is headed. */
function param(value: number) {
  return {
    value,
    cancelScheduledValues() {},
    cancelAndHoldAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime(target: number) {
      this.value = target;
    },
    setValueAtTime(target: number) {
      this.value = target;
    },
    setValueCurveAtTime(curve: Float32Array) {
      this.value = curve[curve.length - 1] ?? this.value;
    },
  };
}

function fakeContext() {
  const gains: ReturnType<typeof param>[] = [];
  const node = (extra: object) => ({ ...extra, connect: (next: unknown) => next });
  const context = {
    currentTime: 0,
    createGain() {
      const gain = param(1);
      gains.push(gain);
      return node({ gain });
    },
    createDelay: () => node({ delayTime: param(0) }),
  };
  // `build` makes the input first and the master second.
  return { context, master: () => gains[1] as ReturnType<typeof param> };
}

describe("crossfade", () => {
  let state: PlaybackState;
  let videoId: string;
  let audio: ReturnType<typeof fakeContext>;
  const seekTo = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    audio = fakeContext();
    videoId = "aaaaaaaaaaa";
    state = { paused: false, positionSeconds: 30, durationSeconds: 200 } as PlaybackState;
    const api = {
      music: { getPlaybackState: () => ({ ...state }), getVideoId: () => videoId },
      player: { seekTo },
      settings: { get: () => 6 },
      audio: {
        addEffect: (_order: number, create: (context: AudioContext) => unknown) =>
          void create(audio.context as unknown as AudioContext),
        setOutputDelay: () => {},
      },
    } as unknown as PluginApi;
    crossfade.onLoad?.(api);
  });

  afterEach(() => {
    crossfade.onUnload?.();
    vi.useRealTimers();
  });

  /** Lets the plugin look a few times, as time goes on. */
  function run(ms: number): void {
    for (let passed = 0; passed < ms; passed += 50) {
      audio.context.currentTime += 0.05;
      if (!state.paused) state.positionSeconds += 0.05;
      vi.advanceTimersByTime(50);
    }
  }

  it("is silent while paused and plays again on resume", () => {
    run(500);
    expect(audio.master().value).toBe(1);
    state.paused = true;
    run(300);
    expect(audio.master().value).toBe(0);
    state.paused = false;
    run(300);
    expect(audio.master().value).toBe(1);
  });

  it("plays again when another track was chosen during the pause", () => {
    run(500);
    state.paused = true;
    run(300);
    // The new track is there before it plays, and then starts in the same moment.
    videoId = "bbbbbbbbbbb";
    state.positionSeconds = 0;
    run(100);
    state.paused = false;
    run(300);
    expect(audio.master().value).toBe(1);
  });

  it("plays again when the new track and playing arrive in one look", () => {
    run(500);
    state.paused = true;
    run(300);
    videoId = "bbbbbbbbbbb";
    state.positionSeconds = 0;
    state.paused = false;
    run(300);
    expect(audio.master().value).toBe(1);
  });
});

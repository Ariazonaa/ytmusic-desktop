import { describe, expect, it } from "vitest";
import { clock, labels, positionNow, share, type MiniState } from "./mini-view";

const state = (changes: Partial<MiniState> = {}): MiniState => ({
  title: "Sugar",
  artist: "Maroon 5",
  cover: null,
  paused: false,
  position: 60,
  duration: 300,
  at: 1_000_000,
  ...changes,
});

describe("the mini player's view", () => {
  it("counts on while playing, and not while paused or past the end", () => {
    expect(positionNow(state(), 1_010_000)).toBe(70);
    expect(positionNow(state({ paused: true }), 1_010_000)).toBe(60);
    expect(positionNow(state(), 2_000_000)).toBe(300);
    expect(positionNow(state(), 999_000)).toBe(60);
  });

  it("shows the time like the player bar", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65.9)).toBe("1:05");
    expect(clock(3725)).toBe("1:02:05");
    expect(clock(-3)).toBe("0:00");
  });

  it("gives the progress as a share, 0 without a length", () => {
    expect(share(state(), 1_000_000)).toBeCloseTo(0.2);
    expect(share(state({ duration: null }), 1_000_000)).toBe(0);
    expect(share(state({ duration: 0 }), 1_000_000)).toBe(0);
  });

  it("speaks German where the system does", () => {
    expect(labels("de-DE").next).toBe("Weiter");
    expect(labels("en-US").next).toBe("Next");
  });
});

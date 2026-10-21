import { describe, expect, it, vi } from "vitest";
import { PlaybackReport } from "./report";

const state = (paused: boolean, positionSeconds: number, durationSeconds: number | null = 300) => ({
  paused,
  positionSeconds,
  durationSeconds,
});

describe("PlaybackReport", () => {
  it("sends at once on a change and otherwise once a second", () => {
    let now = 0;
    const send = vi.fn();
    const report = new PlaybackReport(send, () => now);
    report.update(state(false, 1));
    now = 300;
    report.update(state(false, 1.3));
    expect(send).toHaveBeenCalledTimes(1);
    now = 1000;
    report.update(state(false, 2));
    expect(send).toHaveBeenLastCalledWith(false, 2, 300);
    // Pausing does not wait.
    now = 1100;
    report.update(state(true, 2.1));
    expect(send).toHaveBeenLastCalledWith(true, 2.1, 300);
    // Nor does another track.
    now = 1200;
    report.update(state(true, 0, 200));
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("reports nothing playing without a state", () => {
    const send = vi.fn();
    new PlaybackReport(send, () => 0).update(null);
    expect(send).toHaveBeenCalledWith(true, 0, null);
  });
});

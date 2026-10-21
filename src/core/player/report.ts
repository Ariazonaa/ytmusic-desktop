// Tells the backend what plays, for the taskbar's play / pause button and its
// progress (`taskbar.rs`): at once when playback pauses, goes on or another
// track comes, and otherwise about once a second.
import type { PlaybackState } from "../../shared/types";

type Send = (paused: boolean, position: number, duration: number | null) => void;

const EVERY_MS = 1000;

export class PlaybackReport {
  private last: { paused: boolean; duration: number | null; at: number } | null = null;

  constructor(
    private readonly send: Send,
    private readonly now: () => number = () => Date.now(),
  ) {}

  update(state: PlaybackState | null): void {
    const paused = state?.paused ?? true;
    const duration = state?.durationSeconds ?? null;
    const at = this.now();
    const last = this.last;
    if (last && last.paused === paused && last.duration === duration && at - last.at < EVERY_MS) return;
    this.last = { paused, duration, at };
    this.send(paused, state?.positionSeconds ?? 0, duration);
  }
}

// When the heard sound is silence at the start or the end of a track, and
// what to do about it.

/** At the start, silence within this many seconds is run through quickly. */
export const START_ZONE_SECONDS = 15;
/** At the end, silence within this many seconds before the end skips the rest. */
export const END_ZONE_SECONDS = 20;
/** Silence this long at the start, and the player runs fast through it. */
const START_SILENCE_MS = 300;
/** Silence this long near the end, and the next track comes. */
const END_SILENCE_MS = 1500;
/** How fast the player runs through silence at the start. */
export const FAST_RATE = 3;

export interface Moment {
  /** Seconds into the track, as heard. */
  position: number;
  duration: number | null;
  paused: boolean;
  /** Level of the heard sound in dBFS. */
  db: number;
}

export interface Options {
  start: boolean;
  end: boolean;
  /** Below this level, in dBFS, the sound counts as silence. */
  thresholdDb: number;
}

/** What the player should do now. */
export type Step = "fast" | "normal" | "next" | null;

/** Level in dBFS of samples between -1 and 1. */
export function levelDb(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

export class SilenceSkipper {
  private silentSince: number | null = null;
  private fast = false;
  private skipped = false;
  private lastPosition = 0;

  /** Takes one look at the player at time `now` (milliseconds) and says what to do. */
  look(moment: Moment, now: number, options: Options): Step {
    // A new track, or a jump back: start over.
    if (moment.position + 1 < this.lastPosition) this.skipped = false;
    this.lastPosition = moment.position;
    const silent = !moment.paused && moment.db < options.thresholdDb;
    if (!silent) {
      this.silentSince = null;
      return this.slowDown();
    }
    this.silentSince ??= now;
    const silentFor = now - this.silentSince;
    if (options.start && moment.position < START_ZONE_SECONDS && silentFor >= START_SILENCE_MS) {
      if (this.fast) return null;
      this.fast = true;
      return "fast";
    }
    const left = moment.duration === null ? Infinity : moment.duration - moment.position;
    if (options.end && left < END_ZONE_SECONDS && silentFor >= END_SILENCE_MS && !this.skipped) {
      this.skipped = true;
      this.fast = false;
      return "next";
    }
    return moment.position >= START_ZONE_SECONDS ? this.slowDown() : null;
  }

  /** Back to the normal rate, if the player runs fast. */
  private slowDown(): Step {
    if (!this.fast) return null;
    this.fast = false;
    return "normal";
  }

  reset(): void {
    this.silentSince = null;
    this.fast = false;
    this.skipped = false;
    this.lastPosition = 0;
  }
}

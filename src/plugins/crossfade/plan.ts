// The arithmetic behind the crossfade. See `index.ts` for how it is used.
//
// The player runs faster than real time by a factor `rate`, without pitch
// correction, into a delay line whose delay grows by `slope` seconds per
// second. Reading from a growing delay slows the sound down by `1 - slope`.
// With `rate * (1 - slope) = 1` the two cancel exactly: the listener hears
// the original pitch and tempo, while the player gets ahead of what is heard
// by the size of the delay.

/**
 * The steepest the delay may grow. It bounds how much faster the player runs
 * (about 8.7 %). The cancellation is exact at any slope, but both resampling
 * steps lose a little quality, so the slope stays small.
 */
export const MAX_SLOPE = 0.08;

/** Shorter tails than this are not worth a fade: the tracks are simply switched. */
export const MIN_TAIL_SECONDS = 0.3;

/** How far ahead of the listener the player should be at the end of a track. */
export function targetDelay(crossfadeSeconds: number, durationSeconds: number | null): number {
  if (durationSeconds === null || !(durationSeconds > 0)) return 0;
  // Never let the two fades of a short track take up more than half of it.
  return Math.max(0, Math.min(crossfadeSeconds, durationSeconds / 4));
}

/**
 * The slope at which the delay reaches `target` exactly when the player
 * reaches the end of the track, `remainingSeconds` of track time from now.
 *
 * At slope k the player needs `remaining * (1 - k)` seconds of real time for
 * the rest, in which the delay grows by `k * remaining * (1 - k)`. Setting
 * that equal to the missing delay gives a quadratic in k.
 */
export function slopeFor(target: number, delay: number, remainingSeconds: number): number {
  const missing = target - delay;
  if (!(missing > 0) || !(remainingSeconds > 1)) return 0;
  const x = missing / remainingSeconds;
  // Beyond a quarter there is no real solution: the track ends too soon.
  if (x >= 0.25) return MAX_SLOPE;
  return Math.min(MAX_SLOPE, (1 - Math.sqrt(1 - 4 * x)) / 2);
}

/** The playback rate that cancels a delay growing at `slope`. */
export function rateFor(slope: number): number {
  return 1 / (1 - slope);
}

/**
 * How long the sound still in the delay line lasts. It was recorded at the
 * fast rate, so the delay has to keep growing while it plays out, and it
 * takes a little longer than the delay itself.
 */
export function tailSeconds(delay: number, slope: number): number {
  return delay / (1 - slope);
}

/**
 * Gain curves for the two tracks during the crossfade, with equal power: the
 * sum of the squares is 1 throughout, so the loudness does not dip in the middle.
 */
export function fadeCurves(steps = 64): { out: Float32Array<ArrayBuffer>; in: Float32Array<ArrayBuffer> } {
  const fadeOut = new Float32Array(steps);
  const fadeIn = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const angle = (i / (steps - 1)) * (Math.PI / 2);
    fadeOut[i] = Math.cos(angle);
    fadeIn[i] = Math.sin(angle);
  }
  return { out: fadeOut, in: fadeIn };
}

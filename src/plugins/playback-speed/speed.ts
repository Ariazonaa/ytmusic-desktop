// Which setting holds the speed, and what a rate from the page becomes there.

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 3;
const STEP = 0.05;

/** The setting for the speed of podcasts or of everything else. */
export const speedKey = (podcast: boolean): "podcastSpeed" | "speed" => (podcast ? "podcastSpeed" : "speed");

/** A rate as the setting can hold it: within its range, on its steps. */
export function toSetting(rate: number): number {
  const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, rate));
  return Math.round(Math.round(clamped / STEP) * STEP * 100) / 100;
}

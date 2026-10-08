// Corrections for lyrics that run ahead of or behind the sound, per track.

/** How far a track's lyrics can be shifted, in seconds either way. */
export const MAX_OFFSET_SECONDS = 15;
export const OFFSET_STEP_SECONDS = 0.5;
/** Only this many tracks are remembered; the ones corrected longest ago go first. */
export const MAX_REMEMBERED = 200;

const VIDEO_ID = /^[\w-]{6,20}$/;

const clamp = (seconds: number): number =>
  Math.min(MAX_OFFSET_SECONDS, Math.max(-MAX_OFFSET_SECONDS, Math.round(seconds * 10) / 10));

/**
 * Reads the stored corrections, a JSON object of seconds by video id. A
 * positive number shows the lyrics later. Anything else in the text is dropped.
 */
export function parseOffsets(setting: unknown): Map<string, number> {
  const offsets = new Map<string, number>();
  let parsed: unknown;
  try {
    parsed = typeof setting === "string" && setting !== "" ? JSON.parse(setting) : {};
  } catch {
    return offsets;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return offsets;
  for (const [videoId, seconds] of Object.entries(parsed)) {
    if (VIDEO_ID.test(videoId) && typeof seconds === "number" && Number.isFinite(seconds) && clamp(seconds) !== 0) {
      offsets.set(videoId, clamp(seconds));
    }
  }
  return offsets;
}

/** The stored text after setting one track's correction. Zero forgets the track. */
export function withOffset(offsets: ReadonlyMap<string, number>, videoId: string, seconds: number): string {
  // Insertion order is age: the changed track goes to the end.
  const next = new Map(offsets);
  next.delete(videoId);
  if (clamp(seconds) !== 0) next.set(videoId, clamp(seconds));
  const kept = [...next].slice(-MAX_REMEMBERED);
  return JSON.stringify(Object.fromEntries(kept));
}

/** `+1.5 s`, `−0.5 s` or `0 s`, for the panel. */
export function describeOffset(seconds: number): string {
  if (seconds === 0) return "0 s";
  return `${seconds > 0 ? "+" : "−"}${Math.abs(seconds).toFixed(1)} s`;
}

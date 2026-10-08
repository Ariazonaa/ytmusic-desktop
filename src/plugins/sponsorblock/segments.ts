import type { PluginSettingValues } from "../../shared/types";

export interface Segment {
  id: string;
  /** SponsorBlock category, e.g. `music_offtopic`. */
  category: string;
  start: number;
  end: number;
}

/** Maps the plugin's setting keys to SponsorBlock categories. */
export const CATEGORIES: Readonly<Record<string, string>> = {
  musicOfftopic: "music_offtopic",
  sponsor: "sponsor",
  selfpromo: "selfpromo",
  interaction: "interaction",
  intro: "intro",
  outro: "outro",
};

export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  music_offtopic: "non-music section",
  sponsor: "sponsor",
  selfpromo: "self-promotion",
  interaction: "interaction reminder",
  intro: "intro",
  outro: "outro",
};

/** `45 s`, `12 min` or `3 h 5 min`: a length of time, as precise as it is worth reading. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole} s`;
  const minutes = Math.round(whole / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

/** The categories the user switched on. */
export function enabledCategories(settings: PluginSettingValues): Set<string> {
  return new Set(
    Object.entries(CATEGORIES)
      .filter(([key]) => settings[key] === true)
      .map(([, category]) => category),
  );
}

/**
 * The request URL for a video. SponsorBlock is asked by the first characters
 * of the id's SHA-256 hash, so the server does not learn which video is playing.
 */
export async function segmentsUrl(videoId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(videoId));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const categories = encodeURIComponent(JSON.stringify(Object.values(CATEGORIES)));
  return `https://sponsor.ajay.app/api/skipSegments/${hex.slice(0, 4)}?categories=${categories}`;
}

/** Picks the skippable segments of `videoId` out of a hash-prefix response. */
export function parseSegments(data: unknown, videoId: string): Segment[] {
  if (!Array.isArray(data)) return [];
  const video = data.find((entry: unknown) => isRecord(entry) && entry.videoID === videoId);
  if (!isRecord(video) || !Array.isArray(video.segments)) return [];

  const segments: Segment[] = [];
  for (const raw of video.segments as unknown[]) {
    if (!isRecord(raw) || raw.actionType !== "skip") continue;
    const { UUID: id, category, segment } = raw;
    if (typeof id !== "string" || typeof category !== "string" || !Array.isArray(segment)) continue;
    const [start, end] = segment as unknown[];
    if (typeof start !== "number" || typeof end !== "number" || !(end > start)) continue;
    segments.push({ id, category, start, end });
  }
  return segments.sort((a, b) => a.start - b.start);
}

/**
 * The segment to skip at `position`, if any. Segments in `skipped` are left
 * alone, so seeking back into one plays it.
 */
export function segmentAt(
  segments: readonly Segment[],
  position: number,
  categories: ReadonlySet<string>,
  skipped: ReadonlySet<string>,
): Segment | undefined {
  return segments.find(
    (segment) =>
      position >= segment.start &&
      position < segment.end &&
      categories.has(segment.category) &&
      !skipped.has(segment.id),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface LyricLine {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface Lyrics {
  /** Time-stamped lines, or `null` if only plain text is available. */
  synced: LyricLine[] | null;
  plain: string | null;
}

const TIMESTAMP = /\[(\d+):(\d{1,2}(?:[.:]\d+)?)\]/g;

/** Parses LRC text. A line with several timestamps yields one entry per timestamp. */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(TIMESTAMP)];
    if (stamps.length === 0) continue;
    const content = raw.replace(TIMESTAMP, "").trim();
    for (const [, minutes, seconds] of stamps) {
      const time = Number(minutes) * 60 + Number((seconds ?? "").replace(":", "."));
      if (Number.isFinite(time)) lines.push({ time, text: content });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** Index of the line being sung at `position`, or -1 before the first line. */
export function activeLineIndex(lines: readonly LyricLine[], position: number): number {
  let index = -1;
  for (const [i, line] of lines.entries()) {
    if (line.time > position) break;
    index = i;
  }
  return index;
}

const NOISE = /\s*[([][^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er|remaster(ed)?|hd|4k)\b[^)\]]*[)\]]/gi;

/** Drops additions like "(Official Video)" that lyrics databases do not use. */
export function cleanTitle(title: string): string {
  return title.replace(NOISE, "").trim() || title;
}

export function searchUrl(title: string, artist: string): string {
  const params = new URLSearchParams({ track_name: cleanTitle(title), artist_name: artist });
  return `https://lrclib.net/api/search?${params}`;
}

/** How far a database entry's length may differ from the playing track, in seconds. */
const MAX_DURATION_DIFF = 3;

/**
 * Chooses among LRCLIB search results. Entries of a different length are
 * other versions of the song. Among the rest, the one with the most synced
 * lines wins, which also sorts out near-empty junk entries.
 */
export function pickLyrics(results: unknown, durationSeconds: number | null): Lyrics | null {
  if (!Array.isArray(results)) return null;
  const candidates = (results as unknown[])
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .filter(
      (entry) =>
        durationSeconds === null ||
        (typeof entry.duration === "number" &&
          Math.abs(entry.duration - durationSeconds) <= MAX_DURATION_DIFF),
    )
    .map((entry) => ({
      synced: typeof entry.syncedLyrics === "string" ? parseLrc(entry.syncedLyrics) : [],
      plain: typeof entry.plainLyrics === "string" ? entry.plainLyrics.trim() : "",
    }));

  const bestSynced = candidates.reduce<LyricLine[]>(
    (best, candidate) => (candidate.synced.length > best.length ? candidate.synced : best),
    [],
  );
  const bestPlain = candidates.reduce(
    (best, candidate) => (candidate.plain.length > best.length ? candidate.plain : best),
    "",
  );
  if (bestSynced.length > 1) return { synced: bestSynced, plain: bestPlain || null };
  if (bestPlain !== "") return { synced: null, plain: bestPlain };
  return null;
}

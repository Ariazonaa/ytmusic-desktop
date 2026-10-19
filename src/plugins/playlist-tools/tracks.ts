// The tracks of a playlist, from YouTube Music's own answers, and what is
// made of them: text, CSV and the doubles.

export interface PlaylistTrack {
  videoId: string | null;
  title: string;
  artist: string;
  album: string;
  duration: string;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;

/** The text of a `{ runs: [{ text }] }` or `{ simpleText }`. */
function textOf(value: unknown): string {
  if (!isObject(value)) return "";
  if (typeof value.simpleText === "string") return value.simpleText;
  if (!Array.isArray(value.runs)) return "";
  return value.runs.map((run) => (isObject(run) && typeof run.text === "string" ? run.text : "")).join("");
}

/** Every value under `key` anywhere in `value`, in document order. */
function findAll(value: unknown, key: string, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) findAll(item, key, found);
  } else if (isObject(value)) {
    for (const [name, inner] of Object.entries(value)) {
      if (name === key) found.push(inner);
      else findAll(inner, key, found);
    }
  }
  return found;
}

function videoIdOf(item: Json): string | null {
  const direct = isObject(item.playlistItemData) ? item.playlistItemData.videoId : undefined;
  if (typeof direct === "string") return direct;
  const watch = findAll(item, "watchEndpoint").find((endpoint) => isObject(endpoint) && typeof endpoint.videoId === "string");
  return isObject(watch) ? (watch.videoId as string) : null;
}

/** The text of a list entry's column `index`. */
function columnText(item: Json, index: number): string {
  const columns = Array.isArray(item.flexColumns) ? item.flexColumns : [];
  const column = columns[index];
  const renderer = isObject(column) ? column.musicResponsiveListItemFlexColumnRenderer : undefined;
  return isObject(renderer) ? textOf(renderer.text) : "";
}

function durationOf(item: Json): string {
  const fixed = Array.isArray(item.fixedColumns) ? item.fixedColumns[0] : undefined;
  const renderer = isObject(fixed) ? fixed.musicResponsiveListItemFixedColumnRenderer : undefined;
  return isObject(renderer) ? textOf(renderer.text) : "";
}

/**
 * The tracks in one answer of YouTube Music's server, and the token for the
 * next part of the list, if there is more. Looked for anywhere in the answer:
 * where exactly they sit changes now and then.
 */
export function readAnswer(answer: unknown): { tracks: PlaylistTrack[]; next: string | null } {
  const tracks = findAll(answer, "musicResponsiveListItemRenderer")
    .filter(isObject)
    .map(
      (item): PlaylistTrack => ({
        videoId: videoIdOf(item),
        title: columnText(item, 0),
        artist: columnText(item, 1),
        album: columnText(item, 2),
        duration: durationOf(item),
      }),
    )
    .filter((track) => track.title !== "");
  const tokens = findAll(answer, "continuationCommand")
    .map((command) => (isObject(command) && typeof command.token === "string" ? command.token : null))
    .filter((token): token is string => token !== null);
  return { tracks, next: tokens[0] ?? null };
}

/** One line per track: "Artist – Title". */
export function asText(name: string, tracks: readonly PlaylistTrack[]): string {
  return [name, "", ...tracks.map((track) => `${track.artist} – ${track.title}`)].join("\n") + "\n";
}

/** A spreadsheet runs a cell that starts with one of these, also after spaces or control characters. */
const FORMULA = /^[\s\u0000-\u001f\u007f]*[=+@-]/u;

function csvField(value: string): string {
  // Quoting does not stop a formula: an apostrophe in front makes it text.
  const text = FORMULA.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A spreadsheet's view: title, artist, album, length and link per track. */
export function asCsv(tracks: readonly PlaylistTrack[]): string {
  const rows = [["Title", "Artist", "Album", "Duration", "Link"]];
  for (const track of tracks) {
    const link = track.videoId ? `https://music.youtube.com/watch?v=${track.videoId}` : "";
    rows.push([track.title, track.artist, track.album, track.duration, link]);
  }
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

const normalized = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s*[([].*?[)\]]\s*/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Tracks that are in the list more than once: the same video, or the same
 * title by the same artist, also when one says "(Official Video)". Each group
 * lists the positions, counted from 1.
 */
export function doubles(tracks: readonly PlaylistTrack[]): { track: PlaylistTrack; positions: number[] }[] {
  const groups = new Map<string, { track: PlaylistTrack; positions: number[] }>();
  const byVideo = new Map<string, string>();
  tracks.forEach((track, index) => {
    const key = (track.videoId && byVideo.get(track.videoId)) || `${normalized(track.artist)}|${normalized(track.title)}`;
    if (track.videoId) byVideo.set(track.videoId, key);
    const group = groups.get(key) ?? { track, positions: [] };
    group.positions.push(index + 1);
    groups.set(key, group);
  });
  return [...groups.values()].filter((group) => group.positions.length > 1);
}

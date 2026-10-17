// The text of now-playing.txt.
import type { Song } from "../../shared/types";

/** `format` with {title}, {artist} and {album} filled in from `song`. */
export function nowPlayingText(format: string, song: Song | null): string {
  if (!song) return "";
  return format.replace(/\{(title|artist|album)\}/g, (_, key: "title" | "artist" | "album") => song[key] ?? "");
}

import type { Song } from "../../shared/types";

/** The part of `MediaMetadata` we read; YouTube Music fills it for every track. */
export interface MediaMetadataLike {
  title: string;
  artist: string;
  album: string;
  artwork: readonly { src: string }[];
}

export function songFromMetadata(metadata: MediaMetadataLike | null): Song | null {
  if (!metadata || metadata.title === "") return null;
  return {
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    // Artwork is listed smallest first.
    artworkUrl: metadata.artwork.at(-1)?.src ?? null,
  };
}

/** Reads the current song from the Media Session API, which is stabler than the DOM. */
export function readCurrentSong(): Song | null {
  return songFromMetadata(navigator.mediaSession?.metadata ?? null);
}

/**
 * Detects song changes by polling, since the Media Session API has no change
 * event. `onChange` fires exactly once per new song.
 */
export class SongWatcher {
  private song: Song | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly read: () => Song | null,
    private readonly onChange: (song: Song) => void,
  ) {}

  get current(): Song | null {
    return this.song;
  }

  poll(): void {
    const next = this.read();
    const changed = next !== null && !isSameSong(next, this.song);
    this.song = next;
    if (changed) this.onChange(next);
  }

  start(intervalMs = 1000): void {
    this.stop();
    this.timer = setInterval(() => this.poll(), intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

function isSameSong(a: Song, b: Song | null): boolean {
  return b !== null && a.title === b.title && a.artist === b.artist && a.album === b.album;
}

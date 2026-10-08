import type { JsonResponse, Song } from "../../shared/types";
import { cleanTitle, pickLyrics, searchUrl, type Lyrics } from "./lrc";

export interface FoundLyrics {
  lyrics: Lyrics;
  /** Name of the service the lyrics came from, shown in the panel. */
  source: string;
}

type GetJson = (url: string) => Promise<JsonResponse>;

/** "A, B & C" or "A feat. B" → "A". Databases usually file a song under its first artist. */
export function primaryArtist(artist: string): string {
  return artist.split(/\s*[,&]\s*|\s+(?:feat\.?|ft\.?|x)\s+/i)[0]?.trim() || artist;
}

/** LRCLIB's free-text search finds songs whose artist is written differently there. */
export function freeTextUrl(title: string, artist: string): string {
  const params = new URLSearchParams({ q: `${cleanTitle(title)} ${primaryArtist(artist)}` });
  return `https://lrclib.net/api/search?${params}`;
}

export function lyricsOvhUrl(title: string, artist: string): string {
  const part = (text: string): string => encodeURIComponent(text.replaceAll("/", " "));
  return `https://api.lyrics.ovh/v1/${part(primaryArtist(artist))}/${part(cleanTitle(title))}`;
}

/** lyrics.ovh returns plain text, sometimes with a French credit line on top. */
export function parseLyricsOvh(data: unknown): Lyrics | null {
  if (typeof data !== "object" || data === null) return null;
  const { lyrics } = data as Record<string, unknown>;
  if (typeof lyrics !== "string") return null;
  const plain = lyrics
    .replace(/^Paroles de la chanson.*\r?\n/i, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plain === "" ? null : { synced: null, plain };
}

/**
 * Asks the sources in order and returns the first synced lyrics. Plain lyrics
 * are only used if no source has synced ones. A source that fails is skipped;
 * the error is rethrown only if every source failed.
 */
export async function findLyrics(
  getJson: GetJson,
  song: Song,
  getDuration: () => number | null,
): Promise<FoundLyrics | null> {
  const lrclib = (url: string) => async (): Promise<Lyrics | null> => {
    const { status, data } = await getJson(url);
    return status === 200 ? pickLyrics(data, getDuration()) : null;
  };
  const sources: { name: string; load: () => Promise<Lyrics | null> }[] = [
    { name: "LRCLIB", load: lrclib(searchUrl(song.title, song.artist)) },
    { name: "LRCLIB", load: lrclib(freeTextUrl(song.title, song.artist)) },
    {
      name: "lyrics.ovh",
      load: async () => {
        const { status, data } = await getJson(lyricsOvhUrl(song.title, song.artist));
        return status === 200 ? parseLyricsOvh(data) : null;
      },
    },
  ];

  let plain: FoundLyrics | null = null;
  let failures = 0;
  let lastError: unknown;
  for (const { name, load } of sources) {
    try {
      const lyrics = await load();
      if (lyrics?.synced) return { lyrics, source: name };
      if (lyrics && !plain) plain = { lyrics, source: name };
    } catch (error) {
      failures++;
      lastError = error;
    }
  }
  if (!plain && failures === sources.length) throw lastError;
  return plain;
}

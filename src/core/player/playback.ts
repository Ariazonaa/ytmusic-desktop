import type { PlaybackState } from "../../shared/types";

/** The player element's own API, as far as we use it. */
export interface MoviePlayer extends Element {
  getVideoData?: () => { video_id?: unknown } | undefined;
  /** Seconds into the current track. */
  getCurrentTime?: () => unknown;
  getPlayerResponse?: () =>
    | {
        videoDetails?: { lengthSeconds?: unknown };
        playerConfig?: { audioConfig?: { loudnessDb?: unknown; trackAbsoluteLoudnessLkfs?: unknown } };
      }
    | undefined;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
}

export const findPlayer = (doc: Document): MoviePlayer | null =>
  doc.querySelector<MoviePlayer>("#movie_player");

const positive = (value: unknown): number | null => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : null;
};

/**
 * Reads the live playback state.
 *
 * Position and length come from the player, not from the `<video>` element.
 * YouTube Music plays consecutive tracks through one media stream: when a
 * track runs into the next, the element's clock keeps counting instead of
 * starting over, and its duration already describes the next track some
 * seconds before the end. The player reports both per track.
 */
export function readPlaybackState(doc: Document = document): PlaybackState | null {
  const video = doc.querySelector("video");
  if (!video) return null;
  const player = findPlayer(doc);
  const position = player?.getCurrentTime?.();
  const length = positive(player?.getPlayerResponse?.()?.videoDetails?.lengthSeconds);
  return {
    paused: video.paused,
    positionSeconds:
      typeof position === "number" && Number.isFinite(position) ? position : video.currentTime,
    // The element's duration is NaN until metadata has loaded and Infinity for live streams.
    durationSeconds: length ?? (Number.isFinite(video.duration) ? video.duration : null),
  };
}

/**
 * How loud the current track comes out of the player, in LKFS (about -7 for a
 * loud master, -20 for a quiet one), or `null` if YouTube Music does not say.
 *
 * YouTube Music measures every track against a target and turns down the
 * ones above it by the difference. Tracks below it are left as they are.
 */
export function readLoudnessLkfs(doc: Document = document): number | null {
  const config = findPlayer(doc)?.getPlayerResponse?.()?.playerConfig?.audioConfig;
  const measured = config?.trackAbsoluteLoudnessLkfs;
  const overTarget = config?.loudnessDb;
  if (typeof measured !== "number" || !Number.isFinite(measured)) return null;
  const turnedDown = typeof overTarget === "number" && overTarget > 0 ? overTarget : 0;
  return measured - turnedDown;
}

/** Reads the YouTube video id of the current track from the player, else from the URL. */
export function readVideoId(doc: Document = document): string | null {
  const fromPlayer = findPlayer(doc)?.getVideoData?.()?.video_id;
  if (typeof fromPlayer === "string" && fromPlayer !== "") return fromPlayer;
  return new URLSearchParams(doc.location?.search ?? "").get("v");
}

const EVENTS = ["play", "pause", "seeked", "durationchange"] as const;

/**
 * Calls `onChange` when playback starts, pauses, seeks or learns its duration.
 * Returns a function that stops watching.
 *
 * Media events do not bubble, so this listens in the capture phase on the
 * document. That keeps working if the page replaces its `<video>` element.
 */
export function watchPlayback(
  onChange: (state: PlaybackState) => void,
  doc: Document = document,
): () => void {
  const listener = (event: Event): void => {
    if (!(event.target instanceof HTMLVideoElement)) return;
    const state = readPlaybackState(doc);
    if (state) onChange(state);
  };
  for (const type of EVENTS) doc.addEventListener(type, listener, true);
  return () => {
    for (const type of EVENTS) doc.removeEventListener(type, listener, true);
  };
}

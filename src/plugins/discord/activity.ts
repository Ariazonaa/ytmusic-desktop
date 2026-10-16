// What the Discord status is made of: the track, the player's state and the
// plugin's settings. Shared by the plugin and the preview in the settings
// window, which shows a sample track the same way.
import type { DiscordActivity } from "../../core/settings/client";
import type { LikeStatus, PlaybackState, PluginSettingValues, Song } from "../../shared/types";

type Translate = (text: string) => string;

/** A track for the preview while nothing plays. */
export const SAMPLE_SONG: Song = {
  title: "Never Gonna Give You Up",
  artist: "Rick Astley",
  album: "Whenever You Need Somebody",
  artworkUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
};
export const SAMPLE_STATE: PlaybackState = { paused: false, positionSeconds: 49, durationSeconds: 213 };
export const SAMPLE_VIDEO_ID = "dQw4w9WgXcQ";

/** What Discord should show, or `null` for nothing. */
export function activityFor(
  song: Song | null,
  state: PlaybackState | null,
  videoId: string | null,
  like: LikeStatus | null,
  settings: PluginSettingValues,
  t: Translate,
  now: number = Date.now(),
): DiscordActivity | null {
  if (!song || !state) return null;
  if (state.paused && settings.whenPaused !== "keep") return null;
  const startMs = Math.round(now - state.positionSeconds * 1000);
  const duration = state.durationSeconds;
  const smallText = state.paused ? t("Paused") : like === "like" ? `❤ ${t("You like this track")}` : "ytmusic-desktop";
  return {
    title: song.title,
    artist: song.artist,
    album: song.album,
    coverUrl: song.artworkUrl,
    startMs,
    endMs: duration && duration > 0 ? Math.round(startMs + duration * 1000) : null,
    videoId,
    paused: state.paused,
    display: String(settings.display ?? "artist"),
    showCover: settings.cover !== false,
    showProgress: settings.progress !== false,
    showLinks: settings.links !== false,
    smallText: settings.icon !== false ? smallText : null,
    listenLabel: settings.listenButton !== false ? t("Listen on YouTube Music") : null,
    appLabel: settings.appButton === true ? t("Get the app") : null,
  };
}

/**
 * Whether two statuses look the same in Discord. The start may move by a
 * second or two between two readings of the same playback.
 */
export function sameActivity(a: DiscordActivity | null, b: DiscordActivity | null): boolean {
  if (!a || !b) return a === b;
  const { startMs: startA, endMs: endA, ...restA } = a;
  const { startMs: startB, endMs: endB, ...restB } = b;
  const close = (x: number | null, y: number | null) => (x === null || y === null ? x === y : Math.abs(x - y) < 2000);
  return JSON.stringify(restA) === JSON.stringify(restB) && close(startA, startB) && close(endA, endB);
}

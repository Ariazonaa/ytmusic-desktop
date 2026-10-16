import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  discordSetActivity: vi.fn(() => Promise.resolve()),
  discordClearActivity: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../core/settings/client", () => client);

import type { MusicApi, PlaybackState, PluginApi, PluginSettingValues, Song } from "../../shared/types";
import { activityFor, sameActivity } from "./activity";
import discord from "./index";

const NOW = 1_800_000_000_000;
const t = (text: string) => text;
const song: Song = { title: "Song", artist: "Artist", album: "Album", artworkUrl: "https://lh3.googleusercontent.com/a" };
const playing: PlaybackState = { paused: false, positionSeconds: 30, durationSeconds: 200 };
const defaults: PluginSettingValues = {
  display: "artist",
  cover: true,
  progress: true,
  links: true,
  icon: true,
  listenButton: true,
  appButton: false,
  whenPaused: "hide",
};

afterEach(() => {
  discord.onUnload?.();
  vi.clearAllMocks();
});

describe("activityFor", () => {
  it("turns a playing song and the settings into a status", () => {
    expect(activityFor(song, playing, "dQw4w9WgXcQ", "none", defaults, t, NOW)).toEqual({
      title: "Song",
      artist: "Artist",
      album: "Album",
      coverUrl: "https://lh3.googleusercontent.com/a",
      startMs: NOW - 30_000,
      endMs: NOW + 170_000,
      videoId: "dQw4w9WgXcQ",
      paused: false,
      display: "artist",
      showCover: true,
      showProgress: true,
      showLinks: true,
      smallText: "ytmusic-desktop",
      listenLabel: "Listen on YouTube Music",
      appLabel: null,
    });
  });

  it("follows the settings", () => {
    const off = { ...defaults, display: "title", cover: false, progress: false, links: false, icon: false, listenButton: false, appButton: true };
    expect(activityFor(song, playing, null, "none", off, t, NOW)).toMatchObject({
      display: "title",
      showCover: false,
      showProgress: false,
      showLinks: false,
      smallText: null,
      listenLabel: null,
      appLabel: "Get the app",
    });
    expect(activityFor(song, playing, null, "like", defaults, t, NOW)?.smallText).toBe("❤ You like this track");
  });

  it("shows nothing while paused, unless asked to keep the track", () => {
    const paused = { ...playing, paused: true };
    expect(activityFor(song, paused, null, null, defaults, t, NOW)).toBeNull();
    expect(activityFor(song, paused, null, null, { ...defaults, whenPaused: "keep" }, t, NOW)).toMatchObject({
      paused: true,
      smallText: "Paused",
    });
    expect(activityFor(null, playing, null, null, defaults, t, NOW)).toBeNull();
    expect(activityFor(song, null, null, null, defaults, t, NOW)).toBeNull();
  });

  it("leaves out the end while the length is unknown", () => {
    expect(activityFor(song, { ...playing, durationSeconds: null }, null, null, defaults, t, NOW)?.endMs).toBeNull();
  });
});

describe("sameActivity", () => {
  it("ignores a start that moved by a second", () => {
    const a = activityFor(song, playing, null, null, defaults, t, NOW);
    expect(sameActivity(a, activityFor(song, playing, null, null, defaults, t, NOW + 900))).toBe(true);
    expect(sameActivity(a, activityFor(song, { ...playing, positionSeconds: 90 }, null, null, defaults, t, NOW))).toBe(false);
    expect(sameActivity(a, activityFor({ ...song, title: "Other" }, playing, null, null, defaults, t, NOW))).toBe(false);
    expect(sameActivity(null, null)).toBe(true);
    expect(sameActivity(a, null)).toBe(false);
  });
});

describe("the plugin", () => {
  /** The player as the plugin reads it; tests change `live` as the page would. */
  const live: { song: Song | null; state: PlaybackState | null } = { song: null, state: null };

  function load(current: Song | null, state: PlaybackState | null, settings: PluginSettingValues = defaults): void {
    live.song = current;
    live.state = state;
    const music = {
      getCurrentSong: () => live.song,
      getPlaybackState: () => live.state,
      getVideoId: () => "dQw4w9WgXcQ",
      getLikeStatus: () => "none",
    } as unknown as MusicApi;
    discord.onLoad?.({ music, settings: { getAll: () => settings } } as unknown as PluginApi);
  }

  function play(state: PlaybackState): void {
    live.state = state;
    discord.onPlaybackChange?.(state);
  }

  it("shows what already plays when it starts, and sends a status once", () => {
    load(song, playing);
    expect(client.discordSetActivity).toHaveBeenCalledOnce();
    play(playing);
    expect(client.discordSetActivity).toHaveBeenCalledOnce();
  });

  it("clears the status on pause and when switched off", () => {
    load(song, playing);
    play({ ...playing, paused: true });
    expect(client.discordClearActivity).toHaveBeenCalledOnce();
    play(playing);
    expect(client.discordSetActivity).toHaveBeenCalledTimes(2);
    discord.onUnload?.();
    expect(client.discordClearActivity).toHaveBeenCalledTimes(2);
  });

  it("sends again when a setting changes, with the position of now", () => {
    vi.useFakeTimers({ now: NOW });
    try {
      load(song, playing);
      // A minute later the player is a minute further, without an event.
      vi.setSystemTime(NOW + 60_000);
      live.state = { ...playing, positionSeconds: 90 };
      discord.onSettingsChange?.({ ...defaults, display: "title" });
      expect(client.discordSetActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ display: "title", startMs: NOW - 30_000 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows a new song", () => {
    load(null, null);
    expect(client.discordSetActivity).not.toHaveBeenCalled();
    live.song = song;
    discord.onSongChange?.(song);
    play(playing);
    expect(client.discordSetActivity).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Song" }));
  });
});

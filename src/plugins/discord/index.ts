// Discord: shows in the user's Discord profile what is playing.
//
// The connection to Discord is in the backend (`discord.rs`), which also
// checks what is sent, keeps to Discord's rate limit and sends the status
// again after Discord was restarted. This plugin only turns the song, the
// player's state and its settings into a status (`activity.ts`).
import { t } from "../../core/i18n";
import { parseManifest } from "../../core/plugin-manager/api";
import { discordClearActivity, discordSetActivity, type DiscordActivity } from "../../core/settings/client";
import type { PlaybackState, Plugin, PluginApi, PluginSettingValues, Song } from "../../shared/types";
import { activityFor, sameActivity } from "./activity";
import manifest from "./plugin.json";

export { activityFor, sameActivity } from "./activity";

let api: PluginApi | null = null;
let song: Song | null = null;
let state: PlaybackState | null = null;
let shown: DiscordActivity | null = null;
// Liking a track sends no event; looking now and then picks it up.
let timer: ReturnType<typeof setInterval> | undefined;
const LOOK_AGAIN_MS = 15_000;

function update(settings: PluginSettingValues | undefined = api?.settings.getAll()): void {
  if (!api || !settings) return;
  // The state from the last event has the position of that moment; the
  // player's own state has it now. Started on an old one, the bar would jump back.
  state = api.music.getPlaybackState() ?? state;
  const activity = activityFor(song, state, api.music.getVideoId(), api.music.getLikeStatus(), settings, t);
  if (sameActivity(activity, shown)) return;
  shown = activity;
  void (activity ? discordSetActivity(activity) : discordClearActivity()).catch(() => {});
}

const discord: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    // Started while something plays: show it now, not only at the next track.
    song = pluginApi.music.getCurrentSong();
    state = pluginApi.music.getPlaybackState();
    update();
    timer ??= setInterval(() => update(), LOOK_AGAIN_MS);
  },

  onSongChange(next) {
    song = next;
    update();
  },

  onPlaybackChange(next) {
    state = next;
    update();
  },

  onSettingsChange(values) {
    update(values);
  },

  onUnload() {
    clearInterval(timer);
    timer = undefined;
    api = null;
    song = null;
    state = null;
    shown = null;
    void discordClearActivity().catch(() => {});
  },
};

export default discord;

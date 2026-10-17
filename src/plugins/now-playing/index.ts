// Now playing: hands the playing track to streaming software such as OBS,
// as files in a folder and, if switched on, as a page on 127.0.0.1.
import { parseManifest } from "../../core/plugin-manager/api";
import { nowPlayingServe, nowPlayingUpdate, openNowPlayingFolder } from "../../core/settings/client";
import { t } from "../../core/i18n";
import type { PlaybackState, Plugin, PluginApi, Song } from "../../shared/types";
import { nowPlayingText } from "./text";
import manifest from "./plugin.json";

let api: PluginApi | undefined;
let song: Song | null = null;
let paused = true;
/** What was written last, so that the files change only when something does. */
let written = "";

function write(): void {
  if (!api) return;
  const format = api.settings.get("format");
  const text = nowPlayingText(typeof format === "string" ? format : "", song);
  const track = { title: song?.title ?? "", artist: song?.artist ?? "", album: song?.album ?? "", paused };
  const key = JSON.stringify([text, track, song?.artworkUrl]);
  if (key === written) return;
  written = key;
  nowPlayingUpdate(text, track, song?.artworkUrl ?? null).catch((error: unknown) => {
    console.warn("[now-playing] could not write the files", error);
  });
}

function serve(): void {
  if (!api) return;
  const port = api.settings.get("port");
  const wanted = api.settings.get("page") === true && typeof port === "number" ? port : null;
  nowPlayingServe(wanted).catch((error: unknown) => {
    api?.ui.showNotice(t("Now playing: {reason}", { reason: String(error) }));
  });
}

const nowPlaying: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    song = api.music.getCurrentSong();
    paused = api.music.getPlaybackState()?.paused ?? true;
    written = "";
    write();
    serve();
    // Once: where the files go.
    if (api.settings.get("told") !== true) {
      api.ui.showNotice(t("Now playing goes to text files in a folder of its own."), {
        label: t("Open folder"),
        onClick: () => void openNowPlayingFolder().catch(() => {}),
      });
      api.settings.update({ told: true }).catch(() => {});
    }
  },

  onSongChange(next: Song) {
    song = next;
    write();
  },

  onPlaybackChange(state: PlaybackState) {
    paused = state.paused;
    write();
  },

  onSettingsChange() {
    write();
    serve();
  },

  onUnload() {
    nowPlayingServe(null).catch(() => {});
    api = undefined;
    song = null;
  },
};

export default nowPlaying;

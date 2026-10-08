// Playback speed: plays everything faster or slower.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import manifest from "./plugin.json";

let api: PluginApi | undefined;

function apply(): void {
  if (!api) return;
  const speed = api.settings.get("speed");
  const rate = typeof speed === "number" ? speed : 1;
  api.player.setPlaybackRate(rate, api.settings.get("preservePitch") !== false);
}

const playbackSpeed: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    apply();
  },

  // The player resets its speed when it loads a track, so set it again then.
  onSongChange: apply,
  onPlaybackChange: apply,
  onSettingsChange: apply,

  onUnload() {
    api?.player.setPlaybackRate(1, true);
    api = undefined;
  },
};

export default playbackSpeed;

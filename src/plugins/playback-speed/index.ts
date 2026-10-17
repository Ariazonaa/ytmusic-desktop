// Playback speed: plays music and podcasts faster or slower, each at its own
// speed. A speed chosen in YouTube Music's own menu is kept for that kind.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import { speedKey, toSetting } from "./speed";
import manifest from "./plugin.json";

/** The player element's own API: it tells when its menu changes the speed. */
interface RatePlayer extends Element {
  addEventListener(type: "onPlaybackRateChange", listener: (rate: unknown) => void): void;
  removeEventListener(type: "onPlaybackRateChange", listener: (rate: unknown) => void): void;
}

let api: PluginApi | undefined;
/** The rate this plugin set last, and for which track. */
let applied = 1;
let appliedFor: string | null = null;
let player: RatePlayer | null = null;

const isPodcast = (): boolean => api?.music.getTrackType() === "podcast";

function apply(): void {
  if (!api) return;
  const speed = api.settings.get(speedKey(isPodcast()));
  applied = typeof speed === "number" ? speed : 1;
  appliedFor = api.music.getVideoId();
  api.player.setPlaybackRate(applied, api.settings.get("preservePitch") !== false);
  follow();
}

/**
 * The speed menu of YouTube Music changed the speed: keep it for the kind of
 * track that plays. This plugin sets the rate on the video element, which the
 * player does not report here, so its own changes do not come back as a choice.
 */
function onMenuRate(rate: unknown): void {
  if (!api || typeof rate !== "number" || !Number.isFinite(rate)) return;
  if (Math.abs(rate - applied) < 0.01) return;
  // Only a choice for the track the speed was set for; the player also
  // reports rates while it loads the next one.
  if (api.music.getVideoId() !== appliedFor) return;
  applied = toSetting(rate);
  api.settings.update({ [speedKey(isPodcast())]: applied }).catch((error: unknown) => {
    console.warn("[playback-speed] could not keep the speed", error);
  });
}

/** Listens to the player, which YouTube Music may replace. */
function follow(): void {
  const current = document.querySelector<RatePlayer>("#movie_player");
  if (current === player) return;
  player?.removeEventListener("onPlaybackRateChange", onMenuRate);
  player = current;
  player?.addEventListener("onPlaybackRateChange", onMenuRate);
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
    player?.removeEventListener("onPlaybackRateChange", onMenuRate);
    player = null;
    api?.player.setPlaybackRate(1, true);
    api = undefined;
  },
};

export default playbackSpeed;

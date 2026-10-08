// Normalize: brings every track to the same loudness.
//
// YouTube Music only turns down tracks that are louder than its own, very
// loud target and leaves the rest as they are, so a quiet album track and a
// loud single still differ a lot. This plugin uses the loudness YouTube Music
// measured for each track to bring all of them to one level.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi, PluginSettingValues } from "../../shared/types";
import manifest from "./plugin.json";

/** Position in the audio chain: first after the crossfade, so later effects get an even level. */
const ORDER = 5;

/** Target loudness in LKFS. Streaming services use about -14. */
export const TARGETS: Readonly<Record<string, number>> = { quiet: -18, medium: -14, loud: -11 };
const DEFAULT_TARGET = -14;
const DEFAULT_MAX_BOOST = 6;
/** Tracks are never turned down by more than this; a wrong measurement should not silence one. */
const MAX_CUT_DB = 20;
/** Seconds over which the level moves to that of a new track. */
const SMOOTHING_SECONDS = 0.15;

/** The change in dB that brings a track of `loudnessLkfs` to the chosen target. 0 if the loudness is unknown. */
export function gainDbFor(loudnessLkfs: number | null, settings: PluginSettingValues): number {
  if (loudnessLkfs === null || !Number.isFinite(loudnessLkfs)) return 0;
  const target = TARGETS[String(settings.target)] ?? DEFAULT_TARGET;
  const maxBoost =
    typeof settings.maxBoost === "number" && Number.isFinite(settings.maxBoost)
      ? Math.min(12, Math.max(0, settings.maxBoost))
      : DEFAULT_MAX_BOOST;
  return Math.min(maxBoost, Math.max(-MAX_CUT_DB, target - loudnessLkfs));
}

export const dbToGain = (db: number): number => 10 ** (db / 20);

let api: PluginApi | undefined;
let node: GainNode | undefined;

function apply(): void {
  if (!api || !node) return;
  const gain = dbToGain(gainDbFor(api.music.getLoudnessLkfs(), api.settings.getAll()));
  // A step would click; this glides to the new level.
  node.gain.setTargetAtTime(gain, node.context.currentTime, SMOOTHING_SECONDS / 3);
}

const normalize: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.audio.addEffect(ORDER, (context) => {
      node = context.createGain();
      apply();
      return { input: node, output: node };
    });
  },

  // The loudness arrives with the track's data, which can be before or after
  // the song change is noticed, so both events look again.
  onSongChange: apply,
  onPlaybackChange: apply,
  onSettingsChange: apply,

  onUnload() {
    api = node = undefined;
  },
};

export default normalize;

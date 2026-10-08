// Compressor: evens out loud and quiet passages, so that songs mastered at
// different levels sound about equally loud.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import manifest from "./plugin.json";

/** Position in the audio chain: after the equalizer, so boosted bands are tamed too. */
const ORDER = 20;

interface Strength {
  /** Level in dB above which the signal is reduced. */
  threshold: number;
  /** How strongly it is reduced: 4 means 4 dB over the threshold become 1 dB. */
  ratio: number;
}

// The node raises the overall level by itself to make up for the reduction,
// more so the lower the threshold. No extra gain is needed on top.
const MEDIUM: Strength = { threshold: -24, ratio: 4 };
const STRENGTHS: Readonly<Record<string, Strength>> = {
  light: { threshold: -18, ratio: 2 },
  medium: MEDIUM,
  strong: { threshold: -32, ratio: 8 },
};

let api: PluginApi | undefined;
let compressor: DynamicsCompressorNode | undefined;

function applySettings(): void {
  if (!api || !compressor) return;
  const strength = STRENGTHS[String(api.settings.get("strength"))] ?? MEDIUM;
  compressor.threshold.value = strength.threshold;
  compressor.ratio.value = strength.ratio;
}

const compressorPlugin: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.audio.addEffect(ORDER, (context) => {
      compressor = context.createDynamicsCompressor();
      compressor.knee.value = 30;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      applySettings();
      return { input: compressor, output: compressor };
    });
  },

  onSettingsChange() {
    applySettings();
  },

  onUnload() {
    api = compressor = undefined;
  },
};

export default compressorPlugin;

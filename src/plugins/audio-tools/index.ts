// Audio tools: volume above 100 %, left/right balance and mono.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi, PluginSettingValues } from "../../shared/types";
import manifest from "./plugin.json";

/** Position in the audio chain: last, after the equalizer and the compressor. */
const ORDER = 30;

export interface Levels {
  /** Linear gain for everything: 1 is unchanged, 3 is the maximum. */
  gain: number;
  /** Linear gains per side. Balance only ever turns one side down. */
  left: number;
  right: number;
  mono: boolean;
}

/** Turns the settings into what the audio nodes are set to. */
export function levelsFor(settings: PluginSettingValues): Levels {
  const number = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const balance = Math.min(1, Math.max(-1, number(settings.balance, 0) / 100));
  return {
    gain: Math.min(3, Math.max(1, number(settings.boost, 100) / 100)),
    left: balance > 0 ? 1 - balance : 1,
    right: balance < 0 ? 1 + balance : 1,
    mono: settings.mono === true,
  };
}

interface Nodes {
  mixer: GainNode;
  left: GainNode;
  right: GainNode;
  boost: GainNode;
}

let api: PluginApi | undefined;
let nodes: Nodes | undefined;

function applySettings(): void {
  if (!api || !nodes) return;
  const levels = levelsFor(api.settings.getAll());
  // With one channel the node mixes left and right together.
  nodes.mixer.channelCount = levels.mono ? 1 : 2;
  nodes.left.gain.value = levels.left;
  nodes.right.gain.value = levels.right;
  nodes.boost.gain.value = levels.gain;
}

/**
 *     mixer → stereo → splitter ─┬─ left ──┬─ merger → boost
 *                                └─ right ─┘
 */
function build(context: AudioContext): Nodes {
  const explicit = (node: AudioNode, channels: number): void => {
    node.channelCount = channels;
    node.channelCountMode = "explicit";
    node.channelInterpretation = "speakers";
  };
  const mixer = context.createGain();
  explicit(mixer, 2);
  // Spreads a mono signal over both channels again before they are split.
  const stereo = context.createGain();
  explicit(stereo, 2);
  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(2);
  const left = context.createGain();
  const right = context.createGain();
  const boost = context.createGain();

  mixer.connect(stereo).connect(splitter);
  splitter.connect(left, 0).connect(merger, 0, 0);
  splitter.connect(right, 1).connect(merger, 0, 1);
  merger.connect(boost);
  return { mixer, left, right, boost };
}

const audioTools: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.audio.addEffect(ORDER, (context) => {
      nodes = build(context);
      applySettings();
      return { input: nodes.mixer, output: nodes.boost };
    });
  },

  onSettingsChange() {
    applySettings();
  },

  onUnload() {
    api = nodes = undefined;
  },
};

export default audioTools;

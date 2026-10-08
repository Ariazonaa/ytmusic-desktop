// Headphones: crossfeed and stereo width.
//
// On speakers each ear hears both speakers, the far one a little later and
// duller. Headphones give each ear one channel only, which makes hard-panned
// recordings tiring. Crossfeed adds the missing part: some of the other
// channel, delayed and with the treble taken off.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi, PluginSettingValues } from "../../shared/types";
import manifest from "./plugin.json";

/** Position in the audio chain: after the level and balance of `audio-tools`, before the fades. */
const ORDER = 35;
/** The extra way round the head, in seconds. */
const CROSSFEED_DELAY_SECONDS = 0.0003;
/** Above this the head shadows the far ear. */
const CROSSFEED_CUTOFF_HZ = 700;
/** How much of the other channel the strongest setting adds. */
const MAX_CROSSFEED_GAIN = 0.5;

export interface Levels {
  /** How much of a channel stays in itself after the width change. */
  same: number;
  /** How much of a channel goes into the other one after the width change. Negative widens. */
  other: number;
  /** How much of the filtered other channel is added. */
  crossfeed: number;
  /** Brings the level back to where it was after adding the crossfeed. */
  trim: number;
}

/** Turns the settings into what the audio nodes are set to. */
export function levelsFor(settings: PluginSettingValues): Levels {
  const number = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  // Width scales the difference between the channels and leaves their sum alone:
  // left' = mid + width * side, with mid = (L + R) / 2 and side = (L - R) / 2.
  const width = Math.min(2, Math.max(0, number(settings.width, 100) / 100));
  const crossfeed = (Math.min(100, Math.max(0, number(settings.crossfeed, 30))) / 100) * MAX_CROSSFEED_GAIN;
  return {
    same: (1 + width) / 2,
    other: (1 - width) / 2,
    crossfeed,
    trim: 1 / (1 + crossfeed),
  };
}

interface Nodes {
  input: GainNode;
  output: ChannelMergerNode;
  same: GainNode[];
  other: GainNode[];
  crossfeed: GainNode[];
  trim: GainNode[];
}

let api: PluginApi | undefined;
let nodes: Nodes | undefined;

function applySettings(): void {
  if (!api || !nodes) return;
  const levels = levelsFor(api.settings.getAll());
  const now = nodes.input.context.currentTime;
  const set = (group: GainNode[], value: number): void => {
    // A short glide: a step would click.
    for (const node of group) node.gain.setTargetAtTime(value, now, 0.02);
  };
  set(nodes.same, levels.same);
  set(nodes.other, levels.other);
  set(nodes.crossfeed, levels.crossfeed);
  set(nodes.trim, levels.trim);
}

/**
 * For each side, with the other side's signal coming in mirrored:
 *
 *     in ─ splitter ─┬─ same ──┬─ widened ─┬───────────────────────┬─ trim ─ merger
 *                    └─ other ─┘ (to the   └─ delay ─ lowpass ─ crossfeed ─┘ (to the
 *                                 other side)                                other side)
 */
function build(context: AudioContext): Nodes {
  const input = context.createGain();
  input.channelCount = 2;
  input.channelCountMode = "explicit";
  input.channelInterpretation = "speakers";
  const splitter = context.createChannelSplitter(2);
  const output = context.createChannelMerger(2);
  input.connect(splitter);

  const gain = (): GainNode => context.createGain();
  const widened = [gain(), gain()];
  const built: Nodes = { input, output, same: [], other: [], crossfeed: [], trim: [] };
  for (const side of [0, 1]) {
    const same = gain();
    const other = gain();
    splitter.connect(same, side);
    splitter.connect(other, side);
    same.connect(widened[side] as GainNode);
    other.connect(widened[1 - side] as GainNode);
    built.same.push(same);
    built.other.push(other);
  }
  const trims = [gain(), gain()];
  for (const side of [0, 1]) {
    const own = widened[side] as GainNode;
    const delay = context.createDelay(0.01);
    delay.delayTime.value = CROSSFEED_DELAY_SECONDS;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = CROSSFEED_CUTOFF_HZ;
    lowpass.Q.value = 0.5;
    const crossfeed = gain();
    own.connect(trims[side] as GainNode);
    own.connect(delay).connect(lowpass).connect(crossfeed).connect(trims[1 - side] as GainNode);
    (trims[side] as GainNode).connect(output, 0, side);
    built.crossfeed.push(crossfeed);
  }
  built.trim = trims;
  return built;
}

const headphones: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.audio.addEffect(ORDER, (context) => {
      nodes = build(context);
      applySettings();
      return { input: nodes.input, output: nodes.output };
    });
  },

  onSettingsChange: applySettings,

  onUnload() {
    api = nodes = undefined;
  },
};

export default headphones;

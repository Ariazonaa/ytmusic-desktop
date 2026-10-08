// Track fade: fades each track out at its end and the next one in.
//
// This is not a crossfade. A crossfade plays the end of one track over the
// start of the next, which needs two players, and YouTube Music has one. Here
// the tracks still play one after the other; only the hard cut is softened.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import manifest from "./plugin.json";

/** Position in the audio chain: last, so that nothing after it undoes the fade. */
const ORDER = 40;
const POLL_MS = 100;
/** Seconds over which the gain moves to a new target, to avoid steps. */
const SMOOTHING = 0.05;

/**
 * The volume factor, 0 to 1, at `position` seconds into a track of `duration`
 * seconds. Tracks too short to hold both fades are left alone.
 */
export function fadeGain(position: number, duration: number | null, fadeIn: number, fadeOut: number): number {
  if (duration === null || !(duration > 0) || duration < 2 * (fadeIn + fadeOut)) return 1;
  const rising = fadeIn > 0 ? position / fadeIn : 1;
  const falling = fadeOut > 0 ? (duration - position) / fadeOut : 1;
  const linear = Math.min(1, Math.max(0, Math.min(rising, falling)));
  // Loudness is not heard linearly: squaring makes the fade sound even.
  return linear * linear;
}

let api: PluginApi | undefined;
let context: AudioContext | undefined;
let gain: GainNode | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  if (!api || !context || !gain) return;
  const playback = api.music.getPlaybackState();
  if (!playback) return;
  const seconds = (key: string): number => {
    const value = api?.settings.get(key);
    return typeof value === "number" ? value : 0;
  };
  const target = fadeGain(playback.positionSeconds, playback.durationSeconds, seconds("fadeIn"), seconds("fadeOut"));
  gain.gain.setTargetAtTime(target, context.currentTime, SMOOTHING);
}

const trackFade: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.audio.addEffect(ORDER, (audioContext) => {
      context = audioContext;
      gain = audioContext.createGain();
      return { input: gain, output: gain };
    });
    timer = setInterval(tick, POLL_MS);
  },

  onUnload() {
    clearInterval(timer);
    api = context = gain = undefined;
  },
};

export default trackFade;

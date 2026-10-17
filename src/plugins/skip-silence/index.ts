// Skip silence: runs fast through silence at the start of a track, and goes
// on to the next one when its end is silence. What counts is what is heard,
// measured at the start of the audio chain.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import { FAST_RATE, SilenceSkipper, levelDb, type Options } from "./silence";
import manifest from "./plugin.json";

/** Before the other effects: they could change the level. */
const ORDER = 0;
const LOOK_MS = 50;

let api: PluginApi | undefined;
let analyser: AnalyserNode | undefined;
let samples: Float32Array<ArrayBuffer> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
const skipper = new SilenceSkipper();

function options(): Options {
  const settings = api?.settings.getAll() ?? {};
  const threshold = settings.threshold;
  return {
    start: settings.start !== false,
    end: settings.end !== false,
    thresholdDb: typeof threshold === "number" ? threshold : -60,
  };
}

function look(): void {
  if (!api || !analyser || !samples) return;
  const state = api.music.getPlaybackState();
  if (!state) return;
  analyser.getFloatTimeDomainData(samples);
  const step = skipper.look(
    { position: state.positionSeconds, duration: state.durationSeconds, paused: state.paused, db: levelDb(samples) },
    performance.now(),
    options(),
  );
  if (step === "fast") api.player.setPlaybackRate(FAST_RATE, true);
  else if (step === "normal") api.player.setPlaybackRate(1, true);
  else if (step === "next") {
    api.player.setPlaybackRate(1, true);
    api.player.next();
  }
}

const skipSilence: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    skipper.reset();
    api.audio.addEffect(ORDER, (context) => {
      // The sound passes unchanged; the analyser listens on the side.
      const pass = context.createGain();
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      samples = new Float32Array(analyser.fftSize);
      pass.connect(analyser);
      return { input: pass, output: pass };
    });
    timer = setInterval(look, LOOK_MS);
  },

  onSongChange() {
    // A track that starts must not inherit the fast rate of the one before.
    if (api) api.player.setPlaybackRate(1, true);
    skipper.reset();
  },

  onUnload() {
    clearInterval(timer);
    api?.player.setPlaybackRate(1, true);
    api = analyser = samples = undefined;
  },
};

export default skipSilence;

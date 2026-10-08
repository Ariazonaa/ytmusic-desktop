// Limiter: holds peaks just below full scale, so that what the equalizer,
// `normalize` or `audio-tools` boost does not clip. Sound below the threshold
// passes unchanged.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin } from "../../shared/types";
import manifest from "./plugin.json";

/** Position in the audio chain: after everything that can raise the level. */
const ORDER = 90;

/** Where limiting starts, in dB below full scale. */
export const THRESHOLD_DB = -1.5;
/** Above the threshold, 20 dB more at the input give 1 dB more at the output. */
export const RATIO = 20;

/**
 * The browser's compressor turns its output up to make up for what it takes
 * away: by 0.6 times, in dB, what a full-scale signal loses. A limiter must
 * not get louder, so that is taken back out afterwards.
 */
export function makeupDb(thresholdDb: number, ratio: number): number {
  const fullScaleOutDb = thresholdDb - thresholdDb / ratio;
  return -0.6 * fullScaleOutDb;
}

const limiter: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(api) {
    api.audio.addEffect(ORDER, (context) => {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = THRESHOLD_DB;
      compressor.knee.value = 0;
      compressor.ratio.value = RATIO;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.1;
      const trim = context.createGain();
      trim.gain.value = 10 ** (-makeupDb(THRESHOLD_DB, RATIO) / 20);
      compressor.connect(trim);
      return { input: compressor, output: trim };
    });
  },
};

export default limiter;

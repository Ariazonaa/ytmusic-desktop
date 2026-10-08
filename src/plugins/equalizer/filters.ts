import { FREQUENCIES } from "./bands";
import { magnitudeToDb } from "./curve";

/** Creates the ten band filters, flat. Works for the live and for an offline context. */
export function createFilters(context: BaseAudioContext): BiquadFilterNode[] {
  return FREQUENCIES.map((frequency, index) => {
    const filter = context.createBiquadFilter();
    // The outermost bands are shelves, so they also cover everything beyond them.
    filter.type =
      index === 0 ? "lowshelf" : index === FREQUENCIES.length - 1 ? "highshelf" : "peaking";
    filter.frequency.value = frequency;
    // About one octave wide, matching the spacing of the bands.
    filter.Q.value = 1.41;
    return filter;
  });
}

let scratch: BiquadFilterNode[] | undefined;

/**
 * The combined response in decibels of the bands at the given frequencies.
 * It is computed on filters of the same kind the audio runs through, so the
 * graph shows what is heard, including how neighbouring bands overlap.
 */
export function responseDb(
  gains: readonly number[],
  preampDb: number,
  frequencies: Float32Array<ArrayBuffer>,
): Float32Array {
  // The filters are never connected: they only serve as calculators.
  scratch ??= createFilters(new OfflineAudioContext(1, 1, 48000));
  const total = new Float32Array(frequencies.length).fill(preampDb);
  const magnitude = new Float32Array(frequencies.length);
  const phase = new Float32Array(frequencies.length);
  for (const [index, filter] of scratch.entries()) {
    filter.gain.value = gains[index] ?? 0;
    filter.getFrequencyResponse(frequencies, magnitude, phase);
    for (let i = 0; i < total.length; i++) {
      total[i] = (total[i] ?? 0) + magnitudeToDb(magnitude[i] ?? 1);
    }
  }
  return total;
}

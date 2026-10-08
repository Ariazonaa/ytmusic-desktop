/** The lowest and highest frequency shown. Music has little beyond these. */
export const MIN_HZ = 40;
export const MAX_HZ = 16000;

/**
 * Turns an analyser's spectrum into `count` bar heights from 0 to 1, spaced
 * evenly in pitch rather than in hertz, as the ear hears.
 *
 * `spectrum` holds one byte per frequency bin, from 0 Hz up to half the
 * sample rate.
 */
export function barLevels(spectrum: Uint8Array, sampleRate: number, count: number): number[] {
  const binHz = sampleRate / 2 / spectrum.length;
  const edge = (index: number): number => MIN_HZ * (MAX_HZ / MIN_HZ) ** (index / count);
  const levels: number[] = [];
  for (let bar = 0; bar < count; bar++) {
    const first = Math.min(spectrum.length - 1, Math.floor(edge(bar) / binHz));
    // Low bars are narrower than one bin; each still reads at least one.
    const last = Math.min(spectrum.length - 1, Math.max(first, Math.ceil(edge(bar + 1) / binHz) - 1));
    let peak = 0;
    for (let bin = first; bin <= last; bin++) peak = Math.max(peak, spectrum[bin] ?? 0);
    levels.push(peak / 255);
  }
  return levels;
}

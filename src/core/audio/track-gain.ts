// Loudness per track, shared by two built-in plugins. `normalize` knows how
// much to turn each track up or down; it applies that to the whole sound.
// During a crossfade two tracks sound at once, each needing its own level, so
// while `crossfade` runs it takes the job over and applies the level per track.

/** The gain, as a factor, for a track of this loudness. */
export type GainFor = (loudnessLkfs: number | null) => number;

type Listener = () => void;

let provider: GainFor | null = null;
let takenOver = false;
const listeners = new Set<Listener>();

const notify = (): void => {
  for (const listener of [...listeners]) listener();
};

export const trackGain = {
  /** `normalize` says how to level tracks, or with `null` that it stopped. */
  provide(gainFor: GainFor | null): void {
    provider = gainFor;
    notify();
  },

  /** The gain for a track of this loudness: 1 while nobody levels tracks. */
  gainFor(loudnessLkfs: number | null): number {
    return provider ? provider(loudnessLkfs) : 1;
  },

  /** `crossfade` applies the level per track from now on, or with `false` no longer. */
  takeOver(taking: boolean): void {
    takenOver = taking;
    notify();
  },

  /** Whether the level is applied per track elsewhere, so that `normalize` stays out. */
  get takenOver(): boolean {
    return takenOver;
  },

  /** Calls `listener` when either of the above changes. Returns a function that stops that. */
  onChange(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

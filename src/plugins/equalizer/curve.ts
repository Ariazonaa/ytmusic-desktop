// Geometry of the frequency response graph: frequency runs left to right on a
// logarithmic scale, gain bottom to top in decibels.

export const GRAPH = {
  width: 320,
  height: 120,
  minHz: 20,
  maxHz: 20000,
  /** The graph shows gains from -rangeDb to +rangeDb. */
  rangeDb: 18,
} as const;

/** `count` frequencies from `minHz` to `maxHz`, evenly spaced on the logarithmic scale. */
export function graphFrequencies(count: number): Float32Array<ArrayBuffer> {
  const frequencies = new Float32Array(count);
  const ratio = GRAPH.maxHz / GRAPH.minHz;
  for (let i = 0; i < count; i++) {
    frequencies[i] = GRAPH.minHz * ratio ** (i / (count - 1));
  }
  return frequencies;
}

export function xFor(hz: number): number {
  const position = Math.log(hz / GRAPH.minHz) / Math.log(GRAPH.maxHz / GRAPH.minHz);
  return Math.min(1, Math.max(0, position)) * GRAPH.width;
}

export function yFor(db: number): number {
  const clamped = Math.min(GRAPH.rangeDb, Math.max(-GRAPH.rangeDb, db));
  return ((GRAPH.rangeDb - clamped) / (2 * GRAPH.rangeDb)) * GRAPH.height;
}

/** Converts a filter's magnitude response to decibels. */
export function magnitudeToDb(magnitude: number): number {
  return 20 * Math.log10(Math.max(magnitude, 1e-6));
}

/** The SVG path through the given points of the response. */
export function curvePath(hz: ArrayLike<number>, db: ArrayLike<number>): string {
  let path = "";
  for (let i = 0; i < hz.length; i++) {
    const x = xFor(hz[i] ?? GRAPH.minHz).toFixed(1);
    const y = yFor(db[i] ?? 0).toFixed(1);
    path += `${i === 0 ? "M" : " L"}${x} ${y}`;
  }
  return path;
}

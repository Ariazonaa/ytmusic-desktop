// Reads equalizer settings in the formats the AutoEq project publishes for
// headphones (https://github.com/jaakkopasanen/AutoEq), and fits them to the
// ten bands of this equalizer.
//
// Two formats are understood:
//
//   Preamp: -6.2 dB
//   Filter 1: ON PK Fc 105 Hz Gain -2.7 dB Q 0.70      ("ParametricEQ", "FixedBandEQ")
//
//   GraphicEQ: 20 -0.5; 21 -0.5; 22 -0.6; …             ("GraphicEQ")
import { FREQUENCIES, MAX_GAIN_DB } from "./bands";

export interface AutoEqPreset {
  gains: number[];
  preamp: number;
}

interface Filter {
  type: "PK" | "LSC" | "HSC";
  frequency: number;
  gain: number;
  q: number;
}

// Adding 0 turns a rounded -0.4 into 0 rather than -0.
const round = (db: number): number => Math.round(Math.min(MAX_GAIN_DB, Math.max(-MAX_GAIN_DB, db))) + 0;
const NUMBER = String.raw`(-?\d+(?:\.\d+)?)`;
const FILTER = new RegExp(
  String.raw`^Filter\s+\d+:\s+ON\s+(PK|LSC|HSC|LS|HS)\s+Fc\s+${NUMBER}\s*Hz\s+Gain\s+${NUMBER}\s*dB(?:\s+Q\s+${NUMBER})?`,
  "i",
);
const PREAMP = new RegExp(String.raw`^Preamp:\s*${NUMBER}\s*dB`, "i");

/** What a filter does at `hz`, in dB. An approximation that is exact at the filter's own frequency. */
function filterDb(filter: Filter, hz: number): number {
  const octaves = Math.log2(hz / filter.frequency);
  if (filter.type === "PK") {
    // A peaking filter is about 1.4 / Q octaves wide where it has fallen to half its gain.
    const halfWidth = 1.4 / filter.q / 2;
    return filter.gain / (1 + (octaves / halfWidth) ** 2);
  }
  // A shelf reaches its gain within about an octave on its side of the frequency.
  const toward = filter.type === "LSC" ? -octaves : octaves;
  return filter.gain / (1 + 2 ** (-2 * toward));
}

function parseFilters(lines: readonly string[]): Filter[] {
  const filters: Filter[] = [];
  for (const line of lines) {
    const match = FILTER.exec(line.trim());
    if (!match) continue;
    const kind = (match[1] ?? "").toUpperCase();
    const frequency = Number(match[2]);
    const gain = Number(match[3]);
    const q = match[4] === undefined ? 0.7 : Number(match[4]);
    if (!(frequency > 0) || !Number.isFinite(gain) || !(q > 0)) continue;
    filters.push({ type: kind === "PK" ? "PK" : kind.startsWith("L") ? "LSC" : "HSC", frequency, gain, q });
  }
  return filters;
}

/** The points of a `GraphicEQ:` line, sorted by frequency. */
function parseGraphic(lines: readonly string[]): [number, number][] {
  const line = lines.find((candidate) => /^GraphicEQ:/i.test(candidate.trim()));
  if (!line) return [];
  return line
    .slice(line.indexOf(":") + 1)
    .split(";")
    .map((pair): [number, number] => {
      const [hz, db] = pair.trim().split(/\s+/).map(Number);
      return [hz ?? Number.NaN, db ?? Number.NaN];
    })
    .filter(([hz, db]) => hz > 0 && Number.isFinite(db))
    .sort((a, b) => a[0] - b[0]);
}

/** The curve's value at `hz`, between its two nearest points on a scale of pitch. */
function graphicDb(points: readonly [number, number][], hz: number): number {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return 0;
  if (hz <= first[0]) return first[1];
  if (hz >= last[0]) return last[1];
  const upper = points.findIndex(([frequency]) => frequency >= hz);
  const [lowHz, lowDb] = points[upper - 1] as [number, number];
  const [highHz, highDb] = points[upper] as [number, number];
  const share = Math.log(hz / lowHz) / Math.log(highHz / lowHz);
  return lowDb + (highDb - lowDb) * share;
}

/**
 * Reads AutoEq text and returns the gain for each of the ten bands and a
 * pre-amplifier value, both within the sliders' range. `null` if the text
 * holds no equalizer settings.
 *
 * A file made for exactly these ten bands ("FixedBandEQ") is taken over as
 * it is. Others are sampled at the ten band frequencies, which keeps their
 * shape but not their fine detail.
 */
export function parseAutoEq(text: string): AutoEqPreset | null {
  const lines = text.split(/\r?\n/).slice(0, 2000);
  const filters = parseFilters(lines);
  const points = filters.length === 0 ? parseGraphic(lines) : [];
  if (filters.length === 0 && points.length === 0) return null;

  const curve = (hz: number): number =>
    filters.length > 0 ? filters.reduce((sum, filter) => sum + filterDb(filter, hz), 0) : graphicDb(points, hz);
  // Ten peaking filters an octave apart, at these bands: the file was made for an equalizer like this one.
  const fixedBands =
    filters.length === FREQUENCIES.length &&
    filters.every((filter, index) => filter.type === "PK" && Math.abs(Math.log2(filter.frequency / (FREQUENCIES[index] ?? 1))) < 0.1);
  const gains = fixedBands ? filters.map((filter) => round(filter.gain)) : FREQUENCIES.map((hz) => round(curve(hz)));

  const stated = lines.map((line) => PREAMP.exec(line.trim())).find((match) => match !== null);
  // Without a stated value: lower everything by the largest boost, so that nothing clips.
  const preamp = stated ? Number(stated[1]) : -Math.max(0, ...gains);
  return { gains, preamp: round(preamp) };
}

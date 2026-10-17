import { describe, expect, it } from "vitest";
import { SilenceSkipper, levelDb, type Moment, type Options } from "./silence";

const options: Options = { start: true, end: true, thresholdDb: -60 };
const SILENT = -90;
const LOUD = -12;

/** Feeds looks every 50 ms and returns the steps that were not null. */
function run(skipper: SilenceSkipper, moments: Moment[], opts = options): string[] {
  return moments.map((moment, i) => skipper.look(moment, i * 50, opts)).filter((step): step is NonNullable<typeof step> => step !== null);
}

const at = (position: number, db: number, duration: number | null = 200): Moment => ({ position, duration, paused: false, db });

describe("SilenceSkipper", () => {
  it("runs fast through silence at the start, and back to normal when the music comes", () => {
    const moments = [...Array.from({ length: 10 }, (_, i) => at(i * 0.05, SILENT)), at(0.6, LOUD), at(0.65, LOUD)];
    expect(run(new SilenceSkipper(), moments)).toEqual(["fast", "normal"]);
  });

  it("leaves a short pause at the start alone", () => {
    const moments = [at(1, SILENT), at(1.05, SILENT), at(1.1, LOUD)];
    expect(run(new SilenceSkipper(), moments)).toEqual([]);
  });

  it("goes to the next track after silence near the end, once", () => {
    const moments = Array.from({ length: 40 }, (_, i) => at(190 + i * 0.05, SILENT));
    expect(run(new SilenceSkipper(), moments)).toEqual(["next"]);
  });

  it("leaves silence in the middle alone, and a quiet passage too", () => {
    expect(run(new SilenceSkipper(), Array.from({ length: 40 }, (_, i) => at(100 + i * 0.05, SILENT)))).toEqual([]);
    expect(run(new SilenceSkipper(), Array.from({ length: 40 }, (_, i) => at(i * 0.05, -45)))).toEqual([]);
  });

  it("does what is switched on only", () => {
    const start = Array.from({ length: 10 }, (_, i) => at(i * 0.05, SILENT));
    expect(run(new SilenceSkipper(), start, { ...options, start: false })).toEqual([]);
    const end = Array.from({ length: 40 }, (_, i) => at(190 + i * 0.05, SILENT));
    expect(run(new SilenceSkipper(), end, { ...options, end: false })).toEqual([]);
  });

  it("does nothing while paused", () => {
    const moments = Array.from({ length: 40 }, (_, i) => ({ ...at(i * 0.05, SILENT), paused: true }));
    expect(run(new SilenceSkipper(), moments)).toEqual([]);
  });
});

describe("levelDb", () => {
  it("measures full scale, half and silence", () => {
    expect(levelDb([1, -1, 1, -1])).toBeCloseTo(0);
    expect(levelDb([0.5, -0.5])).toBeCloseTo(-6.02, 1);
    expect(levelDb([0, 0])).toBe(-Infinity);
  });
});

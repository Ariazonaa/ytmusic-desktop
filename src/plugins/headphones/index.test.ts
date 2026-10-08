import { describe, expect, it } from "vitest";
import { parseManifest, resolveSettings } from "../../core/plugin-manager/api";
import { levelsFor } from "./index";
import manifestJson from "./plugin.json";

const defaults = resolveSettings(parseManifest(manifestJson), undefined);
/** What comes out left and right for a signal that is only in the left channel, before the crossfeed. */
const widen = (settings: Record<string, number>): [number, number] => {
  const { same, other } = levelsFor({ ...defaults, ...settings });
  return [same, other];
};

describe("stereo width", () => {
  it("leaves the channels alone at 100 %", () => {
    expect(widen({ width: 100 })).toEqual([1, 0]);
  });

  it("makes both channels the same at 0 %", () => {
    expect(widen({ width: 0 })).toEqual([0.5, 0.5]);
  });

  it("takes the other channel away at 200 %", () => {
    expect(widen({ width: 200 })).toEqual([1.5, -0.5]);
  });

  it("never changes what both channels share", () => {
    for (const width of [0, 50, 100, 150, 200]) {
      const [same, other] = widen({ width });
      expect(same + other).toBeCloseTo(1);
    }
  });
});

describe("crossfeed", () => {
  it("is off at 0 and adds half of the other channel at most", () => {
    expect(levelsFor({ ...defaults, crossfeed: 0 })).toMatchObject({ crossfeed: 0, trim: 1 });
    expect(levelsFor({ ...defaults, crossfeed: 100 }).crossfeed).toBe(0.5);
    expect(levelsFor({ ...defaults, crossfeed: 30 }).crossfeed).toBeCloseTo(0.15);
  });

  it("keeps the level of what is in the middle", () => {
    for (const crossfeed of [0, 30, 100]) {
      const levels = levelsFor({ ...defaults, crossfeed });
      // A sound in the middle is in both channels alike: itself plus the fed part, then the trim.
      expect((1 + levels.crossfeed) * levels.trim).toBeCloseTo(1);
    }
  });
});

describe("invalid settings", () => {
  it("fall back to the defaults and stay in range", () => {
    expect(levelsFor({ crossfeed: "lots", width: null as unknown as number })).toEqual(levelsFor(defaults));
    expect(levelsFor({ crossfeed: 500, width: 900 })).toEqual(levelsFor({ crossfeed: 100, width: 200 }));
    expect(levelsFor({ crossfeed: -5, width: -5 })).toEqual(levelsFor({ crossfeed: 0, width: 0 }));
  });
});

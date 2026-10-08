import { describe, expect, it } from "vitest";
import { parseManifest, resolveSettings } from "../../core/plugin-manager/api";
import {
  presetFileSettings,
  presetFromFile,
  FREQUENCIES,
  MAX_GAIN_DB,
  MAX_USER_PRESETS,
  PRESETS,
  bandKey,
  dbToGain,
  gainsFor,
  parseUserPresets,
  withUserPreset,
} from "./bands";
import manifestJson from "./plugin.json";

const manifest = parseManifest(manifestJson);
const flat = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const mine = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("presets", () => {
  it("have one gain per band, within the slider range", () => {
    for (const [name, gains] of Object.entries(PRESETS)) {
      expect(gains, name).toHaveLength(FREQUENCIES.length);
      for (const gain of gains) expect(Math.abs(gain), name).toBeLessThanOrEqual(MAX_GAIN_DB);
    }
  });
});

describe("manifest", () => {
  it("has a setting for every band within the gain range", () => {
    for (const frequency of FREQUENCIES) {
      expect(manifest.settings?.[bandKey(frequency)], String(frequency)).toMatchObject({
        type: "range",
        min: -MAX_GAIN_DB,
        max: MAX_GAIN_DB,
      });
    }
  });

  it("keeps what the panel edits out of the settings window", () => {
    const shown = Object.entries(manifest.settings ?? {})
      .filter(([, field]) => field.hidden !== true)
      .map(([key]) => key);
    // The one switch the panel has no place for.
    expect(shown).toEqual(["perDevice"]);
  });

  it("accepts built-in, saved and custom presets in the preset setting", () => {
    const stored = { preset: "user:Mine", presets: JSON.stringify([{ name: "Mine", gains: mine }]) };
    expect(resolveSettings(manifest, stored)).toMatchObject(stored);
  });
});

describe("gainsFor", () => {
  it("is flat with the default settings", () => {
    expect(gainsFor(resolveSettings(manifest, undefined))).toEqual(PRESETS.flat);
  });

  it("uses the selected preset and ignores the sliders", () => {
    expect(gainsFor({ preset: "rock", band32: 12 })).toEqual(PRESETS.rock);
  });

  it("uses the sliders with the custom preset", () => {
    const gains = gainsFor({ preset: "custom", band32: 6, band1000: -4.5, band16000: 99 });
    expect(gains).toEqual([6, 0, 0, 0, 0, -4.5, 0, 0, 0, MAX_GAIN_DB]);
  });

  it("uses a saved preset", () => {
    const presets = JSON.stringify([{ name: "Mine", gains: mine }]);
    expect(gainsFor({ preset: "user:Mine", presets, band32: -9 })).toEqual(mine);
  });

  it("falls back to the sliders when the saved preset is gone", () => {
    expect(gainsFor({ preset: "user:Deleted", presets: "[]", band32: 3 })[0]).toBe(3);
  });

  it("returns a copy, so presets cannot be modified through it", () => {
    gainsFor({ preset: "bass" })[0] = 0;
    expect(PRESETS.bass?.[0]).toBe(7);
  });
});

describe("parseUserPresets", () => {
  it("reads well-formed presets", () => {
    expect(parseUserPresets(JSON.stringify([{ name: "Mine", gains: mine }]))).toEqual([{ name: "Mine", gains: mine }]);
  });

  it("drops everything that is not a well-formed preset", () => {
    const damaged = JSON.stringify([
      { name: "ok", gains: flat },
      { name: "", gains: flat },
      { name: "too few", gains: [1, 2] },
      { name: "ok", gains: mine },
      { name: "x".repeat(31), gains: flat },
      { gains: flat },
      "text",
      null,
    ]);
    expect(parseUserPresets(damaged)).toEqual([{ name: "ok", gains: flat }]);
  });

  it("clamps gains and replaces non-numbers", () => {
    const gains = [99, -99, "5", null, 0, 0, 0, 0, 0, 0];
    expect(parseUserPresets(JSON.stringify([{ name: "a", gains }]))[0]?.gains).toEqual([12, -12, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("is empty for anything that is not a JSON list", () => {
    for (const value of ["not json", "{}", "5", "", undefined, 7]) expect(parseUserPresets(value)).toEqual([]);
  });

  it("stops at the limit", () => {
    const many = Array.from({ length: MAX_USER_PRESETS + 5 }, (_, i) => ({ name: `p${i}`, gains: flat }));
    expect(parseUserPresets(JSON.stringify(many))).toHaveLength(MAX_USER_PRESETS);
  });
});

describe("withUserPreset", () => {
  it("adds a preset under its trimmed name", () => {
    expect(withUserPreset([], "  Mine ", mine)).toEqual([{ name: "Mine", gains: mine }]);
  });

  it("replaces a preset of the same name in place", () => {
    const presets = [
      { name: "a", gains: flat },
      { name: "b", gains: flat },
    ];
    expect(withUserPreset(presets, "a", mine)).toEqual([
      { name: "a", gains: mine },
      { name: "b", gains: flat },
    ]);
    expect(presets[0]?.gains).toEqual(flat);
  });

  it("rejects unusable names and a full list", () => {
    expect(() => withUserPreset([], "   ", flat)).toThrow("name");
    expect(() => withUserPreset([], "x".repeat(31), flat)).toThrow("30");
    const full = Array.from({ length: MAX_USER_PRESETS }, (_, i) => ({ name: `p${i}`, gains: flat }));
    expect(() => withUserPreset(full, "one more", flat)).toThrow("limit");
    expect(withUserPreset(full, "p3", mine)).toHaveLength(MAX_USER_PRESETS);
  });
});

describe("dbToGain", () => {
  it("converts decibels to a linear factor", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(20)).toBeCloseTo(10);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
  });
});

describe("preset files", () => {
  const gains = [12, 10, 4, 2, 0, 0, 0, -1, -2, -12];

  it("writes one value per band and the pre-amplifier", () => {
    expect(presetFileSettings(gains, -3)).toEqual({
      band32: 12, band64: 10, band125: 4, band250: 2, band500: 0,
      band1000: 0, band2000: 0, band4000: -1, band8000: -2, band16000: -12,
      preamp: -3,
    });
  });

  it("reads back what it wrote", () => {
    expect(presetFromFile(presetFileSettings(gains, -3))).toEqual({ gains, preamp: -3 });
  });

  it("keeps values from a file within the sliders' range", () => {
    const read = presetFromFile({ band32: 99, band64: -99, band125: "4", band250: null, preamp: 40 });
    expect(read).toEqual({ gains: [12, -12, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 12 });
  });

  it("refuses a file that is not an equalizer preset", () => {
    expect(presetFromFile({ scheme: "midnight", blur: 14 })).toBeNull();
    expect(presetFromFile({})).toBeNull();
    expect(presetFromFile({ band32: "loud" })).toBeNull();
  });
});

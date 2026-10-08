import { describe, expect, it } from "vitest";
import { parseManifest, resolveSettings } from "../../core/plugin-manager/api";
import { TARGETS, dbToGain, gainDbFor } from "./index";
import manifestJson from "./plugin.json";

const manifest = parseManifest(manifestJson);
const defaults = resolveSettings(manifest, undefined);

describe("gainDbFor", () => {
  it("offers exactly the targets it knows", () => {
    const field = manifest.settings?.target;
    const options = field?.type === "select" ? field.options.map((option) => option.value) : [];
    expect(options).toEqual(Object.keys(TARGETS));
  });

  it("turns loud tracks down and quiet tracks up to the target", () => {
    expect(gainDbFor(-8, defaults)).toBe(-6);
    expect(gainDbFor(-14, defaults)).toBe(0);
    expect(gainDbFor(-17, defaults)).toBe(3);
    expect(gainDbFor(-8, { ...defaults, target: "loud" })).toBe(-3);
    expect(gainDbFor(-8, { ...defaults, target: "quiet" })).toBe(-10);
  });

  it("limits the boost", () => {
    expect(gainDbFor(-30, defaults)).toBe(6);
    expect(gainDbFor(-30, { ...defaults, maxBoost: 0 })).toBe(0);
    expect(gainDbFor(-30, { ...defaults, maxBoost: 12 })).toBe(12);
    expect(gainDbFor(-30, { ...defaults, maxBoost: 99 })).toBe(12);
  });

  it("limits the cut", () => {
    expect(gainDbFor(40, defaults)).toBe(-20);
  });

  it("leaves tracks of unknown loudness alone", () => {
    expect(gainDbFor(null, defaults)).toBe(0);
    expect(gainDbFor(Number.NaN, defaults)).toBe(0);
  });

  it("falls back to the defaults for invalid settings", () => {
    expect(gainDbFor(-30, { target: "nope", maxBoost: "lots" })).toBe(6);
    expect(gainDbFor(-8, { target: "nope" })).toBe(-6);
  });
});

describe("dbToGain", () => {
  it("converts decibels to a factor", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(dbToGain(6)).toBeCloseTo(1.995, 3);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 6);
  });
});

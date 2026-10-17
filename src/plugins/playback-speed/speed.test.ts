import { describe, expect, it } from "vitest";
import manifest from "./plugin.json";
import { MAX_SPEED, MIN_SPEED, speedKey, toSetting } from "./speed";

describe("speed", () => {
  it("keeps podcasts apart from music", () => {
    expect(speedKey(true)).toBe("podcastSpeed");
    expect(speedKey(false)).toBe("speed");
  });

  it("turns a rate from the page into what the setting holds", () => {
    expect(toSetting(1.25)).toBe(1.25);
    expect(toSetting(1.3333)).toBe(1.35);
    expect(toSetting(0.25)).toBe(MIN_SPEED);
    expect(toSetting(4)).toBe(MAX_SPEED);
  });

  it("matches the ranges in the manifest", () => {
    for (const key of ["speed", "podcastSpeed"] as const) {
      const field = manifest.settings[key];
      expect([field.min, field.max], key).toEqual([MIN_SPEED, MAX_SPEED]);
    }
  });
});

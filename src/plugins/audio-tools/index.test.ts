import { describe, expect, it } from "vitest";
import { parseManifest, resolveSettings } from "../../core/plugin-manager/api";
import { levelsFor } from "./index";
import manifestJson from "./plugin.json";

describe("levelsFor", () => {
  it("leaves the sound unchanged with the default settings", () => {
    const defaults = resolveSettings(parseManifest(manifestJson), undefined);
    expect(levelsFor(defaults)).toEqual({ gain: 1, left: 1, right: 1, mono: false });
  });

  it("converts the boost percentage", () => {
    expect(levelsFor({ boost: 250 }).gain).toBe(2.5);
  });

  it("turns down only the side the balance moves away from", () => {
    expect(levelsFor({ balance: 50 })).toMatchObject({ left: 0.5, right: 1 });
    expect(levelsFor({ balance: -25 })).toMatchObject({ left: 1, right: 0.75 });
    expect(levelsFor({ balance: 100 })).toMatchObject({ left: 0, right: 1 });
  });

  it("keeps values within safe limits", () => {
    expect(levelsFor({ boost: 9000, balance: 500 })).toMatchObject({ gain: 3, left: 0, right: 1 });
    expect(levelsFor({ boost: 10, balance: -500 })).toMatchObject({ gain: 1, left: 1, right: 0 });
    expect(levelsFor({ boost: "loud", balance: Number.NaN })).toMatchObject({ gain: 1, left: 1, right: 1 });
  });

  it("passes mono through", () => {
    expect(levelsFor({ mono: true }).mono).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Plugin, PluginApi, PluginManifest, SettingField } from "../../shared/types";
import { parseManifest, resolveSettings, type Services } from "./api";
import { PluginManager } from "./manager";

const schema: Record<string, SettingField> = {
  enabled: { type: "boolean", label: "Enabled", default: true },
  label: { type: "string", label: "Label", default: "Demo" },
  size: { type: "number", label: "Size", default: 10, min: 1, max: 20 },
  color: {
    type: "select",
    label: "Color",
    default: "red",
    options: [
      { value: "red", label: "Red" },
      { value: "blue", label: "Blue" },
    ],
  },
};
const manifest: PluginManifest = { name: "p", version: "1.0.0", permissions: [], settings: schema };
const defaults = { enabled: true, label: "Demo", size: 10, color: "red" };

describe("resolveSettings", () => {
  it("returns the defaults without stored values", () => {
    expect(resolveSettings(manifest, undefined)).toEqual(defaults);
  });

  it("uses stored values that fit the schema", () => {
    const stored = { enabled: false, label: "Hi", size: 20, color: "blue" };
    expect(resolveSettings(manifest, stored)).toEqual(stored);
  });

  it("falls back to the default for values that do not fit", () => {
    const stored = { enabled: "yes", label: 5, size: 21, color: "green", unknown: true };
    expect(resolveSettings(manifest, stored)).toEqual(defaults);
  });

  it("is empty for a plugin without settings", () => {
    const plain = { name: "p", version: "1.0.0", permissions: [] };
    expect(resolveSettings(plain, { anything: 1 })).toEqual({});
  });
});

describe("parseManifest settings", () => {
  const base = { name: "p", version: "1.0.0", permissions: [] };

  it("accepts a valid schema", () => {
    expect(parseManifest({ ...base, settings: schema }).settings).toEqual(schema);
  });

  it.each([
    ["a non-object schema", []],
    ["an invalid key", { "bad key": schema.enabled }],
    ["a missing label", { a: { type: "boolean", default: true } }],
    ["an unknown type", { a: { type: "color", label: "A", default: "#fff" } }],
    ["a default of the wrong type", { a: { type: "boolean", label: "A", default: "true" } }],
    ["a select without options", { a: { type: "select", label: "A", default: "x", options: [] } }],
    [
      "a select default outside the options",
      { a: { type: "select", label: "A", default: "x", options: [{ value: "y", label: "Y" }] } },
    ],
    ["a non-numeric min", { a: { type: "number", label: "A", default: 1, min: "0" } }],
  ])("rejects %s", (_label, settings) => {
    expect(() => parseManifest({ ...base, settings })).toThrow();
  });
});

describe("PluginManager plugin settings", () => {
  const saveSettings = vi.fn(() => Promise.resolve());
  const services: Services = {
    music: { getCurrentSong: () => null, getPlaybackState: () => null, getVideoId: () => null, getLoudnessLkfs: () => null, getLikeStatus: () => null, getQueue: () => [] },
    player: { seekTo: () => {}, setPlaybackRate: () => {}, getVolume: () => null, setVolume: () => null, next: () => {}, setLikeStatus: () => true, addToQueue: () => Promise.resolve(), removeFromQueue: () => {}, moveInQueue: () => {} },
    audio: { addEffect: () => () => {}, setOutputDelay: () => {}, getOutputDevice: () => Promise.resolve(null), onOutputDeviceChange: () => () => {} },
    net: { getJson: () => Promise.resolve({ status: 200, data: null }), request: () => Promise.resolve({ status: 200, text: "{}", data: {} }) },
    notify: { show: () => Promise.resolve() },
    saveSettings,
    ui: {
      injectCss: () => () => {},
      waitForElement: () => Promise.resolve(document.body),
      showNotice: () => {},
      addShortcut: () => () => {},
      navigate: () => {},
      addNavButton: () => () => {},
      addPanel: () => {
        throw new Error("not used in these tests");
      },
    },
  };
  const silent = { warn: vi.fn(), error: vi.fn() };

  function setup() {
    let api: PluginApi | undefined;
    const onSettingsChange = vi.fn();
    const plugin: Plugin = { manifest, onLoad: (given) => void (api = given), onSettingsChange };
    const manager = new PluginManager([plugin], services, silent);
    const getApi = (): PluginApi => {
      if (!api) throw new Error("plugin was not loaded");
      return api;
    };
    return { manager, getApi, onSettingsChange };
  }

  it("gives a plugin its stored settings on load", () => {
    const { manager, getApi } = setup();
    manager.setPluginSettings({ p: { label: "Stored" } });
    manager.enable(["p"]);

    expect(getApi().settings.get("label")).toBe("Stored");
    expect(getApi().settings.getAll()).toEqual({ ...defaults, label: "Stored" });
    expect(getApi().settings.get("missing")).toBeUndefined();
  });

  it("calls onSettingsChange only when the effective settings change", () => {
    const { manager, getApi, onSettingsChange } = setup();
    manager.enable(["p"]);

    manager.setPluginSettings({ p: { label: "Demo" }, other: { x: 1 } });
    expect(onSettingsChange).not.toHaveBeenCalled();

    manager.setPluginSettings({ p: { color: "blue" } });
    expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({ ...defaults, color: "blue" });
    expect(getApi().settings.get("color")).toBe("blue");
  });

  it("saves settings that fit the schema and rejects the rest", async () => {
    const { manager, getApi } = setup();
    manager.enable(["p"]);
    saveSettings.mockClear();

    await getApi().settings.update({ color: "blue", size: 5 });
    expect(saveSettings).toHaveBeenCalledExactlyOnceWith("p", { color: "blue", size: 5 });

    await expect(getApi().settings.update({ color: "green" })).rejects.toThrow("color");
    await expect(getApi().settings.update({ size: 99 })).rejects.toThrow("size");
    await expect(getApi().settings.update({ unknown: true })).rejects.toThrow("unknown");
    await expect(getApi().settings.update({ label: "ok", enabled: "yes" })).rejects.toThrow("enabled");
    expect(saveSettings).toHaveBeenCalledOnce();
  });

  it("does not let a plugin change its settings through getAll", () => {
    const { manager, getApi } = setup();
    manager.enable(["p"]);
    getApi().settings.getAll().label = "Changed";
    expect(getApi().settings.get("label")).toBe("Demo");
  });
});

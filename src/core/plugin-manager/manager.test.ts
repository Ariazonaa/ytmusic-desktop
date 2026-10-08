import { describe, expect, it, vi } from "vitest";
import type { Permission, PlaybackState, Plugin, PluginApi, Song } from "../../shared/types";
import { PermissionError, parseManifest, type Services } from "./api";
import { PluginManager } from "./manager";

const song: Song = { title: "Song", artist: "Artist", album: "Album", artworkUrl: null };
const playback: PlaybackState = { paused: false, positionSeconds: 1, durationSeconds: 100 };

function makeServices() {
  const removeCss = vi.fn();
  const services: Services = {
    music: {
      getCurrentSong: () => song,
      getPlaybackState: () => playback,
      getVideoId: () => "abc",
      getLoudnessLkfs: () => null, getLikeStatus: () => null, getQueue: () => [],
    },
    player: { seekTo: vi.fn(), setPlaybackRate: vi.fn(), getVolume: () => 50, setVolume: vi.fn(() => 50), next: vi.fn(), setLikeStatus: vi.fn(() => true), addToQueue: vi.fn(() => Promise.resolve()), removeFromQueue: vi.fn(), moveInQueue: vi.fn() },
    audio: { addEffect: vi.fn(() => vi.fn()), setOutputDelay: vi.fn(), getOutputDevice: vi.fn(() => Promise.resolve(null)), onOutputDeviceChange: vi.fn(() => vi.fn()) },
    net: { getJson: vi.fn(() => Promise.resolve({ status: 200, data: { ok: true } })), request: vi.fn(() => Promise.resolve({ status: 200, text: "{}", data: {} })) },
    notify: { show: vi.fn(() => Promise.resolve()) },
    saveSettings: vi.fn(() => Promise.resolve()),
    ui: {
      injectCss: vi.fn(() => removeCss),
      waitForElement: vi.fn(() => Promise.resolve(document.body)),
      showNotice: vi.fn(),
      addShortcut: vi.fn(() => () => {}),
      navigate: vi.fn(() => {}),
      addNavButton: vi.fn(() => vi.fn()),
      addPanel: vi.fn(() => {
        throw new Error("not used in these tests");
      }),
    },
  };
  return { services, removeCss };
}

function makePlugin(name: string, permissions: Permission[], hooks: Partial<Plugin> = {}): Plugin {
  return { manifest: { name, version: "1.0.0", permissions }, ...hooks };
}

const silent = { warn: vi.fn(), error: vi.fn() };

describe("PluginManager", () => {
  it("loads only the enabled plugins", () => {
    const a = makePlugin("a", [], { onLoad: vi.fn() });
    const b = makePlugin("b", [], { onLoad: vi.fn() });
    const manager = new PluginManager([a, b], makeServices().services, silent);

    manager.enable(["b"]);

    expect(a.onLoad).not.toHaveBeenCalled();
    expect(b.onLoad).toHaveBeenCalledOnce();
    expect(manager.activeNames).toEqual(["b"]);
  });

  it("skips unknown plugin names with a warning", () => {
    const log = { warn: vi.fn(), error: vi.fn() };
    const manager = new PluginManager([], makeServices().services, log);

    manager.enable(["missing"]);

    expect(manager.activeNames).toEqual([]);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("does not load a plugin that conflicts with a running one, in either direction", () => {
    const crossfade = makePlugin("crossfade", [], { onLoad: vi.fn() });
    crossfade.manifest.conflicts = ["track-fade"];
    const trackFade = makePlugin("track-fade", [], { onLoad: vi.fn() });
    const other = makePlugin("other", [], { onLoad: vi.fn() });
    const log = { warn: vi.fn(), error: vi.fn() };

    const first = new PluginManager([crossfade, trackFade, other], makeServices().services, log);
    first.enable(["crossfade", "track-fade", "other"]);
    expect(first.activeNames).toEqual(["crossfade", "other"]);

    const second = new PluginManager([crossfade, trackFade], makeServices().services, log);
    second.enable(["track-fade", "crossfade"]);
    expect(second.activeNames).toEqual(["track-fade"]);
    expect(log.warn).toHaveBeenCalledTimes(2);

    // Once the rival is gone, the plugin loads.
    second.setEnabled(["crossfade"]);
    expect(second.activeNames).toEqual(["crossfade"]);
  });

  it("does not load a plugin twice", () => {
    const a = makePlugin("a", [], { onLoad: vi.fn() });
    const manager = new PluginManager([a], makeServices().services, silent);

    manager.enable(["a", "a"]);
    manager.enable(["a"]);

    expect(a.onLoad).toHaveBeenCalledOnce();
  });

  it("setEnabled loads new plugins, unloads dropped ones and keeps the rest", () => {
    const a = makePlugin("a", [], { onLoad: vi.fn(), onUnload: vi.fn() });
    const b = makePlugin("b", [], { onLoad: vi.fn(), onUnload: vi.fn() });
    const c = makePlugin("c", [], { onLoad: vi.fn(), onUnload: vi.fn() });
    const manager = new PluginManager([a, b, c], makeServices().services, silent);
    manager.enable(["a", "b"]);

    manager.setEnabled(["b", "c"]);

    expect(manager.activeNames).toEqual(["b", "c"]);
    expect(a.onUnload).toHaveBeenCalledOnce();
    expect(b.onLoad).toHaveBeenCalledOnce();
    expect(b.onUnload).not.toHaveBeenCalled();
    expect(c.onLoad).toHaveBeenCalledOnce();
  });

  it("setExternalPlugins replaces external plugins and leaves built-in ones alone", () => {
    const builtin = makePlugin("builtin", [], { onLoad: vi.fn(), onUnload: vi.fn() });
    const oldVersion = makePlugin("ext", [], { onLoad: vi.fn(), onUnload: vi.fn() });
    const gone = makePlugin("gone", [], { onUnload: vi.fn() });
    const manager = new PluginManager([builtin], makeServices().services, silent);
    manager.setExternalPlugins([oldVersion, gone]);
    manager.enable(["builtin", "ext", "gone"]);

    const newVersion = makePlugin("ext", [], { onLoad: vi.fn() });
    const shadow = makePlugin("builtin", [], { onLoad: vi.fn() });
    manager.setExternalPlugins([newVersion, shadow]);

    expect(oldVersion.onUnload).toHaveBeenCalledOnce();
    expect(gone.onUnload).toHaveBeenCalledOnce();
    expect(builtin.onUnload).not.toHaveBeenCalled();
    expect(manager.activeNames).toEqual(["builtin"]);

    manager.setEnabled(["builtin", "ext", "gone"]);
    expect(newVersion.onLoad).toHaveBeenCalledOnce();
    expect(oldVersion.onLoad).toHaveBeenCalledOnce();
    expect(shadow.onLoad).not.toHaveBeenCalled();
    expect(manager.activeNames).toEqual(["builtin", "ext"]);
  });

  it("delivers onUIReady, also to plugins enabled afterwards", () => {
    const early = makePlugin("early", [], { onUIReady: vi.fn() });
    const late = makePlugin("late", [], { onUIReady: vi.fn() });
    const manager = new PluginManager([early, late], makeServices().services, silent);

    manager.enable(["early"]);
    manager.notifyUIReady();
    manager.enable(["late"]);

    expect(early.onUIReady).toHaveBeenCalledOnce();
    expect(late.onUIReady).toHaveBeenCalledOnce();
  });

  it("sends song changes only to plugins with music.read", () => {
    const reader = makePlugin("reader", ["music.read"], { onSongChange: vi.fn() });
    const other = makePlugin("other", ["ui.inject"], { onSongChange: vi.fn() });
    const manager = new PluginManager([reader, other], makeServices().services, silent);
    manager.enable(["reader", "other"]);

    manager.notifySongChange(song);

    expect(reader.onSongChange).toHaveBeenCalledWith(song);
    expect(other.onSongChange).not.toHaveBeenCalled();
  });

  it("sends playback changes only to plugins with music.read", () => {
    const reader = makePlugin("reader", ["music.read"], { onPlaybackChange: vi.fn() });
    const other = makePlugin("other", ["ui.inject"], { onPlaybackChange: vi.fn() });
    const manager = new PluginManager([reader, other], makeServices().services, silent);
    manager.enable(["reader", "other"]);

    manager.notifyPlaybackChange(playback);

    expect(reader.onPlaybackChange).toHaveBeenCalledWith(playback);
    expect(other.onPlaybackChange).not.toHaveBeenCalled();
  });

  it("unloads a plugin whose hook throws and keeps the others running", () => {
    const { services, removeCss } = makeServices();
    const broken = makePlugin("broken", ["music.read", "ui.inject"], {
      onLoad: (api) => void api.ui.injectCss("body {}"),
      onSongChange: () => {
        throw new Error("boom");
      },
      onUnload: vi.fn(),
    });
    const healthy = makePlugin("healthy", ["music.read"], { onSongChange: vi.fn() });
    const log = { warn: vi.fn(), error: vi.fn() };
    const manager = new PluginManager([broken, healthy], services, log);
    manager.enable(["broken", "healthy"]);

    manager.notifySongChange(song);

    expect(manager.activeNames).toEqual(["healthy"]);
    expect(healthy.onSongChange).toHaveBeenCalledOnce();
    expect(broken.onUnload).toHaveBeenCalledOnce();
    expect(removeCss).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledOnce();
  });

  it("unloadAll calls onUnload and removes injected CSS", () => {
    const { services, removeCss } = makeServices();
    const a = makePlugin("a", ["ui.inject"], {
      onLoad: (api) => void api.ui.injectCss("body {}"),
      onUnload: vi.fn(),
    });
    const manager = new PluginManager([a], services, silent);
    manager.enable(["a"]);

    manager.unloadAll();

    expect(a.onUnload).toHaveBeenCalledOnce();
    expect(removeCss).toHaveBeenCalledOnce();
    expect(manager.activeNames).toEqual([]);
  });
});

describe("plugin API permissions", () => {
  function loadWith(permissions: Permission[]): PluginApi {
    let api: PluginApi | undefined;
    const plugin = makePlugin("p", permissions, { onLoad: (given) => void (api = given) });
    new PluginManager([plugin], makeServices().services, silent).enable(["p"]);
    if (!api) throw new Error("onLoad was not called");
    return api;
  }

  it("grants the namespaces the manifest asks for", () => {
    const api = loadWith(["music.read", "ui.inject"]);
    expect(api.music.getCurrentSong()).toEqual(song);
    expect(api.music.getPlaybackState()).toEqual(playback);
    expect(typeof api.ui.injectCss("body {}")).toBe("function");
  });

  it("throws PermissionError for everything else", () => {
    const api = loadWith([]);
    expect(() => api.music).toThrow(PermissionError);
    expect(() => api.player).toThrow(PermissionError);
    expect(() => api.ui).toThrow(PermissionError);
    expect(() => api.net).toThrow(PermissionError);
  });

  it("limits network access to HTTPS on the hosts in the manifest", async () => {
    const { services } = makeServices();
    let api: PluginApi | undefined;
    const plugin: Plugin = {
      manifest: { name: "p", version: "1.0.0", permissions: ["network"], hosts: ["api.example.com"] },
      onLoad: (given) => void (api = given),
    };
    new PluginManager([plugin], services, silent).enable(["p"]);
    if (!api) throw new Error("onLoad was not called");

    await expect(api.net.getJson("https://api.example.com/x?y=1")).resolves.toEqual({
      status: 200,
      data: { ok: true },
    });
    await expect(api.net.getJson("https://evil.example.com/")).rejects.toThrow("may not contact");
    await expect(api.net.getJson("http://api.example.com/")).rejects.toThrow("may not contact");
    await expect(api.net.getJson("https://api.example.com.evil.net/")).rejects.toThrow();
    await expect(api.net.getJson("not a url")).rejects.toThrow("invalid URL");
    expect(services.net.getJson).toHaveBeenCalledExactlyOnceWith("https://api.example.com/x?y=1");
  });

  it("sets the output delay back to zero when the plugin unloads", () => {
    const { services } = makeServices();
    const plugin = makePlugin("p", ["audio"], {
      onLoad: (api) => {
        api.audio.setOutputDelay(3);
        api.audio.setOutputDelay(4);
      },
    });
    const manager = new PluginManager([plugin], services, silent);
    manager.enable(["p"]);
    expect(services.audio.setOutputDelay).toHaveBeenLastCalledWith(4);

    manager.unloadAll();

    expect(services.audio.setOutputDelay).toHaveBeenLastCalledWith(0);
    expect(services.audio.setOutputDelay).toHaveBeenCalledTimes(3);
  });

  it("removes injected CSS only once", () => {
    const { services, removeCss } = makeServices();
    const plugin = makePlugin("p", ["ui.inject"], {
      onLoad: (api) => api.ui.injectCss("body {}")(),
    });
    const manager = new PluginManager([plugin], services, silent);
    manager.enable(["p"]);
    manager.unloadAll();
    expect(removeCss).toHaveBeenCalledOnce();
  });
});

describe("parseManifest", () => {
  it("accepts a valid manifest", () => {
    const manifest = { name: "discord-rpc", version: "0.1.0", permissions: ["music.read"] };
    expect(parseManifest(manifest)).toEqual(manifest);
  });

  it.each([
    ["a non-object", null],
    ["a bad name", { name: "Bad Name", version: "1", permissions: [] }],
    ["a missing version", { name: "a", permissions: [] }],
    ["missing permissions", { name: "a", version: "1" }],
    ["an unknown permission", { name: "a", version: "1", permissions: ["fs.write"] }],
    ["network without hosts", { name: "a", version: "1", permissions: ["network"] }],
    ["invalid conflicts", { name: "a", version: "1", permissions: [], conflicts: ["Not A Name"] }],
    ["an invalid host", { name: "a", version: "1", permissions: [], hosts: ["https://x.com/"] }],
  ])("rejects %s", (_label, json) => {
    expect(() => parseManifest(json)).toThrow();
  });
});

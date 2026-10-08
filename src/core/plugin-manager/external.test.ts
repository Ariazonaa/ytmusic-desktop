import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL, type FrameMessage, type HostMessage } from "../../sandbox/protocol";
import type { Permission, Plugin, PluginManifest } from "../../shared/types";
import type { Services } from "./api";
import { createPanel } from "../injector/panel";
import { createExternalPlugin } from "./external";
import { PluginManager } from "./manager";

const song = { title: "Song", artist: "Artist", album: "", artworkUrl: null };

function setup(permissions: Permission[], hosts?: string[]) {
  const removeCss = vi.fn();
  const removeButton = vi.fn();
  let clickButton: (() => void) | undefined;
  const services: Services = {
    music: { getCurrentSong: () => song, getPlaybackState: () => null, getVideoId: () => "abc", getLoudnessLkfs: () => null, getLikeStatus: () => null, getQueue: () => [] },
    player: { seekTo: vi.fn(), setPlaybackRate: vi.fn(), getVolume: () => 50, setVolume: vi.fn(() => 50), next: vi.fn(), setLikeStatus: vi.fn(() => true), addToQueue: vi.fn(() => Promise.resolve()), removeFromQueue: vi.fn(), moveInQueue: vi.fn() },
    audio: { addEffect: vi.fn(() => vi.fn()), setOutputDelay: vi.fn(), getOutputDevice: vi.fn(() => Promise.resolve(null)), onOutputDeviceChange: vi.fn(() => vi.fn()) },
    ui: {
      injectCss: vi.fn(() => removeCss),
      waitForElement: () => Promise.resolve(document.body),
      showNotice: vi.fn(),
      addShortcut: vi.fn(() => () => {}),
      navigate: vi.fn(() => {}),
      addNavButton: vi.fn((_label: string, onClick: () => void) => {
        clickButton = onClick;
        return removeButton;
      }),
      addPanel: (title: string) => createPanel(title, document, () => {}),
    },
    net: { getJson: vi.fn(() => Promise.resolve({ status: 200, data: 1 })), request: vi.fn(() => Promise.resolve({ status: 200, text: "{}", data: {} })) },
    notify: { show: vi.fn(() => Promise.resolve()) },
    saveSettings: vi.fn(() => Promise.resolve()),
  };
  const manifest: PluginManifest = { name: "ext", version: "1.0.0", permissions };
  if (hosts) manifest.hosts = hosts;
  const log = { warn: vi.fn(), error: vi.fn() };
  const plugin: Plugin = createExternalPlugin(manifest, "about:blank", document, log, (title) =>
    createPanel(title, document, () => {}),
  );
  const manager = new PluginManager([plugin], services, log);
  manager.enable(["ext"]);

  const frame = document.querySelector("iframe");
  if (!frame?.contentWindow) throw new Error("no iframe");
  const frameWindow = frame.contentWindow;
  const sent: HostMessage[] = [];
  vi.spyOn(frameWindow, "postMessage").mockImplementation((message: unknown) => {
    sent.push(message as HostMessage);
  });

  /** Delivers a message as if the iframe had posted it. */
  const fromFrame = (data: unknown, source: unknown = frameWindow): void => {
    window.dispatchEvent(new MessageEvent("message", { data, source: source as Window }));
  };
  const ready = (): void => fromFrame({ ytmd: PROTOCOL, type: "ready" } satisfies FrameMessage);
  let nextId = 1;
  const call = async (method: string, ...args: unknown[]): Promise<HostMessage> => {
    const id = nextId++;
    fromFrame({ ytmd: PROTOCOL, type: "call", id, method, args });
    await vi.waitFor(() => {
      expect(sent.some((m) => m.type === "result" && m.id === id)).toBe(true);
    });
    return sent.find((m) => m.type === "result" && m.id === id) as HostMessage;
  };
  return {
    manager, services, frame, sent, fromFrame, ready, call, removeCss, removeButton, log,
    clickButton: () => clickButton?.(),
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("createExternalPlugin", () => {
  it("runs the plugin in a sandboxed iframe inside a hidden panel", () => {
    const { frame } = setup([]);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.closest("aside")?.hidden).toBe(true);
  });

  it("shows and hides the panel on request", async () => {
    const { frame, ready, call } = setup(["ui.inject"]);
    const panel = frame.closest("aside") as HTMLElement;
    ready();

    expect(await call("ui.showPanel", "History")).toMatchObject({ ok: true });
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector("header span")?.textContent).toBe("History");
    // The iframe must not be moved or replaced: that would restart the plugin.
    expect(panel.querySelector("iframe")).toBe(frame);

    await call("ui.showPanel");
    expect(panel.querySelector("header span")?.textContent).toBe("ext");

    await call("ui.hidePanel");
    expect(panel.hidden).toBe(true);
  });

  it("tells the plugin when the user closes the panel", async () => {
    const { frame, ready, call, sent } = setup(["ui.inject"]);
    const panel = frame.closest("aside") as HTMLElement;
    ready();
    await call("ui.showPanel", "History");

    panel.querySelector("button")?.click();

    expect(panel.hidden).toBe(true);
    expect(sent.at(-1)).toEqual({ ytmd: PROTOCOL, type: "event", name: "panelClose", payload: undefined });
  });

  it("keeps the panel hidden without the ui.inject permission", async () => {
    const { frame, ready, call } = setup([]);
    ready();
    expect(await call("ui.showPanel", "History")).toMatchObject({ ok: false });
    expect(await call("ui.showPanel", "x".repeat(61))).toMatchObject({ ok: false });
    expect(frame.closest("aside")?.hidden).toBe(true);
  });

  it("answers calls the manifest permits", async () => {
    const { ready, call } = setup(["music.read"]);
    ready();
    expect(await call("music.getCurrentSong")).toMatchObject({ ok: true, value: song });
    expect(await call("music.getVideoId")).toMatchObject({ ok: true, value: "abc" });
    expect(await call("settings.getAll")).toMatchObject({ ok: true, value: {} });
  });

  it("rejects calls without permission", async () => {
    const { ready, call, services } = setup([]);
    ready();
    for (const [method, ...args] of [
      ["music.getCurrentSong"],
      ["player.seekTo", 10],
      ["net.getJson", "https://example.com/"],
      ["ui.injectCss", "body{}"],
      ["ui.showNotice", "hi"],
      ["ui.addNavButton", "Hi"],
    ] as [string, ...unknown[]][]) {
      const result = await call(method, ...args);
      expect(result, method).toMatchObject({ ok: false });
      expect((result as { error: string }).error).toContain("permission");
    }
    expect(services.player.seekTo).not.toHaveBeenCalled();
    expect(services.net.getJson).not.toHaveBeenCalled();
  });

  it("limits network calls to the manifest's hosts", async () => {
    const { ready, call } = setup(["network"], ["api.example.com"]);
    ready();
    expect(await call("net.getJson", "https://api.example.com/x")).toMatchObject({ ok: true });
    expect(await call("net.getJson", "https://music.youtube.com/")).toMatchObject({ ok: false });
  });

  it("rejects unknown methods and malformed arguments", async () => {
    const { ready, call, services } = setup(["music.control", "ui.inject", "network"], ["a.example.com"]);
    ready();
    expect(await call("constructor")).toMatchObject({ ok: false });
    expect(await call("toString")).toMatchObject({ ok: false });
    expect(await call("player.seekTo", "10")).toMatchObject({ ok: false });
    expect(await call("net.getJson", { href: "https://a.example.com/" })).toMatchObject({ ok: false });
    expect(await call("ui.injectCss", 5)).toMatchObject({ ok: false });
    expect(await call("ui.showNotice", "x".repeat(201))).toMatchObject({ ok: false });
    expect(await call("ui.addNavButton", "x".repeat(41))).toMatchObject({ ok: false });
    expect(services.ui.injectCss).not.toHaveBeenCalled();
  });

  it("ignores messages that do not come from the plugin's iframe", async () => {
    const { ready, fromFrame, sent, services } = setup(["music.control"]);
    ready();
    fromFrame({ ytmd: PROTOCOL, type: "call", id: 1, method: "player.seekTo", args: [5] }, window);
    fromFrame({ type: "call", id: 2, method: "player.seekTo", args: [5] });
    await Promise.resolve();
    expect(services.player.seekTo).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("holds events back until the plugin is ready", () => {
    const { manager, ready, sent } = setup(["music.read"]);
    manager.notifySongChange(song);
    manager.notifyUIReady();
    expect(sent).toEqual([]);

    ready();
    expect(sent).toEqual([
      { ytmd: PROTOCOL, type: "event", name: "songChange", payload: song },
      { ytmd: PROTOCOL, type: "event", name: "uiReady", payload: undefined },
    ]);
  });

  it("lets the plugin add and remove CSS and buttons", async () => {
    const { ready, call, sent, removeCss, removeButton, clickButton } = setup(["ui.inject"]);
    ready();
    const css = (await call("ui.injectCss", "body{}")) as { value: number };
    const button = (await call("ui.addNavButton", "Hi")) as { value: number };

    clickButton();
    expect(sent.at(-1)).toEqual({
      ytmd: PROTOCOL, type: "event", name: "buttonClick", payload: { id: button.value },
    });

    await call("ui.removeCss", css.value);
    await call("ui.removeNavButton", button.value);
    expect(removeCss).toHaveBeenCalledOnce();
    expect(removeButton).toHaveBeenCalledOnce();
  });

  it("caps the number of styles and buttons", async () => {
    const { ready, call, removeCss } = setup(["ui.inject"]);
    ready();
    for (let i = 0; i < 32; i++) expect(await call("ui.injectCss", "a{}")).toMatchObject({ ok: true });
    expect(await call("ui.injectCss", "a{}")).toMatchObject({ ok: false });
    expect(removeCss).toHaveBeenCalledOnce();
  });

  it("removes the iframe and everything it injected on unload", async () => {
    const { manager, ready, call, removeCss, removeButton } = setup(["ui.inject"]);
    ready();
    await call("ui.injectCss", "body{}");
    await call("ui.addNavButton", "Hi");

    manager.unloadAll();

    expect(document.querySelector("iframe")).toBeNull();
    expect(removeCss).toHaveBeenCalledOnce();
    expect(removeButton).toHaveBeenCalledOnce();
  });

  it("logs errors the plugin reports", () => {
    const { fromFrame, log } = setup([]);
    fromFrame({ ytmd: PROTOCOL, type: "error", message: "boom" });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('"ext"'), "boom");
  });
});

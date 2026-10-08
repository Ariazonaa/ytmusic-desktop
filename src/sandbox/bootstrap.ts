// Runs inside a plugin's sandboxed iframe, before the plugin's own script.
// It defines the global `ytmd` API, which talks to the injected script in the
// YouTube Music page through messages. The iframe has no other way out.
import { PROTOCOL, type FrameMessage, type HostMessage, type SandboxApi } from "./protocol";

type Handler = (payload: unknown) => void;

const HOST_ORIGIN = "https://music.youtube.com";
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const handlers = new Map<string, Set<Handler>>();
const buttonHandlers = new Map<number, () => void>();
/** What to do when a notification is clicked, by a number this side chooses. */
const clickHandlers = new Map<number, () => void>();
let nextClickId = 1;
const MAX_CLICK_HANDLERS = 20;
let nextCallId = 1;

function post(message: FrameMessage): void {
  parent.postMessage(message, HOST_ORIGIN);
}

function call<T>(method: string, ...args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextCallId++;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    post({ ytmd: PROTOCOL, type: "call", id, method, args });
  });
}

function emit(name: string, payload: unknown): void {
  // Buttons and shortcuts share one table: both are a handle with a function to call.
  if (name === "buttonClick" || name === "shortcutPress") {
    buttonHandlers.get((payload as { id: number }).id)?.();
    return;
  }
  if (name === "notificationClick") {
    const { id } = payload as { id: number };
    const handler = clickHandlers.get(id);
    clickHandlers.delete(id);
    handler?.();
    return;
  }
  for (const handler of [...(handlers.get(name) ?? [])]) handler(payload);
}

addEventListener("message", (event: MessageEvent<HostMessage | undefined>) => {
  const message = event.data;
  if (event.source !== parent || message?.ytmd !== PROTOCOL) return;
  if (message.type === "event") {
    emit(message.name, message.payload);
    return;
  }
  const call = pending.get(message.id);
  if (!call) return;
  pending.delete(message.id);
  if (message.ok) call.resolve(message.value);
  else call.reject(new Error(message.error));
});

const api: SandboxApi = {
  on(event, handler) {
    const set = handlers.get(event) ?? new Set<Handler>();
    handlers.set(event, set);
    set.add(handler as Handler);
    return () => set.delete(handler as Handler);
  },
  getLanguage: () => call("getLanguage"),
  music: {
    getCurrentSong: () => call("music.getCurrentSong"),
    getPlaybackState: () => call("music.getPlaybackState"),
    getVideoId: () => call("music.getVideoId"),
    getLoudnessLkfs: () => call("music.getLoudnessLkfs"),
    getLikeStatus: () => call("music.getLikeStatus"),
    getQueue: () => call("music.getQueue"),
  },
  player: {
    seekTo: (seconds) => call("player.seekTo", seconds),
    setPlaybackRate: (rate, preservePitch = true) => call("player.setPlaybackRate", rate, preservePitch),
    getVolume: () => call("player.getVolume"),
    setVolume: (percent) => call("player.setVolume", percent),
    next: () => call("player.next"),
    setLikeStatus: (status) => call("player.setLikeStatus", status),
    addToQueue: (videoId, position = "next") => call("player.addToQueue", videoId, position),
    removeFromQueue: (index) => call("player.removeFromQueue", index),
    moveInQueue: (from, to) => call("player.moveInQueue", from, to),
  },
  net: {
    getJson: (url) => call("net.getJson", url),
    request: (url, request = {}) => call("net.request", url, request),
  },
  notify: {
    show(title, body = "", options = {}) {
      let clickId: number | null = null;
      if (typeof options.onClick === "function") {
        clickId = nextClickId++;
        clickHandlers.set(clickId, options.onClick);
        for (const id of [...clickHandlers.keys()].slice(0, -MAX_CLICK_HANDLERS)) clickHandlers.delete(id);
      }
      return call("notify.show", title, body, { imageUrl: options.imageUrl ?? null, clickId });
    },
  },
  settings: {
    get: async (key) => (await api.settings.getAll())[key],
    getAll: () => call("settings.getAll"),
    update: (values) => call("settings.update", values),
  },
  ui: {
    async injectCss(css) {
      const id = await call<number>("ui.injectCss", css);
      return () => call("ui.removeCss", id);
    },
    showNotice: (text) => call("ui.showNotice", text),
    async addNavButton(label, onClick) {
      const id = await call<number>("ui.addNavButton", label);
      buttonHandlers.set(id, onClick);
      return () => {
        buttonHandlers.delete(id);
        return call("ui.removeNavButton", id);
      };
    },
    showPanel: (title) => (title === undefined ? call("ui.showPanel") : call("ui.showPanel", title)),
    hidePanel: () => call("ui.hidePanel"),
    async addShortcut(shortcut, onPress) {
      const id = await call<number>("ui.addShortcut", shortcut);
      buttonHandlers.set(id, onPress);
      return () => {
        buttonHandlers.delete(id);
        return call("ui.removeShortcut", id);
      };
    },
    navigate: (target) => call("ui.navigate", target),
  },
};

Object.defineProperty(globalThis, "ytmd", { value: Object.freeze(api) });

const report = (reason: unknown): void => {
  post({ ytmd: PROTOCOL, type: "error", message: reason instanceof Error ? reason.message : String(reason) });
};
addEventListener("error", (event) => report(event.error ?? event.message));
addEventListener("unhandledrejection", (event) => report(event.reason));
// `load` fires after the plugin's module script has run, so its handlers are in place.
addEventListener("load", () => post({ ytmd: PROTOCOL, type: "ready" }));

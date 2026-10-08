import { PROTOCOL, type FrameMessage, type HostMessage } from "../../sandbox/protocol";
import type { LikeStatus, NavigationTarget, NetRequest, Panel, Plugin, PluginApi, PluginManifest } from "../../shared/types";
import { getLanguage } from "../i18n";
import { createPanel } from "../injector/panel";

const MAX_CSS_LENGTH = 256 * 1024;
const MAX_NOTICE_LENGTH = 200;
const MAX_LABEL_LENGTH = 40;
const MAX_TITLE_LENGTH = 60;
const MAX_URL_LENGTH = 2048;
const MAX_SHORTCUT_LENGTH = 60;
const MAX_NOTIFICATION_TITLE_LENGTH = 80;
const MAX_NOTIFICATION_BODY_LENGTH = 240;
const LIKE_STATUSES = ["like", "dislike", "none"];
/** Per plugin, so a misbehaving one cannot flood the page with styles or buttons. */
const MAX_HANDLES = 32;

type Logger = Pick<Console, "error">;

function text(value: unknown, maxLength: number, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} must be a string`);
  if (value.length > maxLength) throw new Error(`${what} is too long`);
  return value;
}

/**
 * Wraps an external plugin as a regular `Plugin`.
 *
 * The plugin's code runs in a sandboxed iframe loaded from `frameUrl` and
 * reaches the page only through messages. Each message is answered by calling
 * the plugin's `PluginApi`, so the permissions of its manifest apply exactly
 * as they do for built-in plugins. Arguments come from untrusted code and are
 * checked before use.
 *
 * The iframe lives in a panel that stays hidden until the plugin asks to show
 * it. The plugin draws its interface in its own document, so a visible panel
 * gives it no more access to the page than a hidden one.
 */
export function createExternalPlugin(
  manifest: PluginManifest,
  frameUrl: string,
  doc: Document = document,
  log: Logger = console,
  makePanel: (title: string) => Panel = (title) => createPanel(title, doc),
): Plugin {
  let panel: Panel | undefined;
  let onMessage: ((event: MessageEvent) => void) | undefined;
  let frameWindow: (() => Window | null) | undefined;
  let ready = false;
  let queued: HostMessage[] = [];

  const send = (message: HostMessage): void => {
    if (!ready) queued.push(message);
    // The iframe's origin is opaque, so no narrower target than "*" exists.
    else frameWindow?.()?.postMessage(message, "*");
  };
  const emit = (name: string, payload?: unknown): void => {
    send({ ytmd: PROTOCOL, type: "event", name, payload });
  };

  function methods(api: PluginApi, ownPanel: Panel): Record<string, (args: unknown[]) => unknown> {
    const removers = new Map<number, () => void>();
    let nextHandle = 1;
    const keep = (remove: () => void): number => {
      if (removers.size >= MAX_HANDLES) {
        remove();
        throw new Error("too many styles, buttons and shortcuts");
      }
      removers.set(nextHandle, remove);
      return nextHandle++;
    };
    const release = ([handle]: unknown[]): void => {
      removers.get(handle as number)?.();
      removers.delete(handle as number);
    };

    return {
      getLanguage: () => getLanguage(),
      "music.getCurrentSong": () => api.music.getCurrentSong(),
      "music.getPlaybackState": () => api.music.getPlaybackState(),
      "music.getVideoId": () => api.music.getVideoId(),
      "music.getLoudnessLkfs": () => api.music.getLoudnessLkfs(),
      "music.getLikeStatus": () => api.music.getLikeStatus(),
      "music.getQueue": () => api.music.getQueue(),
      "player.next": () => api.player.next(),
      "player.setLikeStatus": ([status]) => {
        if (!LIKE_STATUSES.includes(status as string)) throw new Error("status must be like, dislike or none");
        return api.player.setLikeStatus(status as LikeStatus);
      },
      "player.seekTo": ([seconds]) => {
        if (typeof seconds !== "number") throw new Error("seconds must be a number");
        api.player.seekTo(seconds);
      },
      "player.setPlaybackRate": ([rate, preservePitch]) => {
        if (typeof rate !== "number") throw new Error("rate must be a number");
        api.player.setPlaybackRate(rate, preservePitch !== false);
      },
      "player.getVolume": () => api.player.getVolume(),
      "player.setVolume": ([percent]) => {
        if (typeof percent !== "number") throw new Error("percent must be a number");
        return api.player.setVolume(percent);
      },
      "net.getJson": ([url]) => api.net.getJson(text(url, MAX_URL_LENGTH, "url")),
      // The API checks method, headers and body, as it does for built-in plugins.
      "net.request": ([url, request]) => api.net.request(text(url, MAX_URL_LENGTH, "url"), request as NetRequest),
      "notify.show": ([title, body, options]) => {
        const { imageUrl, clickId } = (typeof options === "object" && options !== null ? options : {}) as Record<
          string,
          unknown
        >;
        return api.notify.show(
          text(title, MAX_NOTIFICATION_TITLE_LENGTH, "title"),
          text(body ?? "", MAX_NOTIFICATION_BODY_LENGTH, "body"),
          {
            // Which addresses are loaded is decided where the picture is fetched.
            imageUrl: typeof imageUrl === "string" && imageUrl.length <= MAX_URL_LENGTH ? imageUrl : null,
            // The frame chose the number; it gets it back when the notification is clicked.
            ...(typeof clickId === "number" ? { onClick: () => emit("notificationClick", { id: clickId }) } : {}),
          },
        );
      },
      // The positions are checked against the queue where the change is made.
      "player.removeFromQueue": ([index]) => {
        if (typeof index !== "number") throw new Error("index must be a number");
        api.player.removeFromQueue(index);
      },
      "player.moveInQueue": ([from, to]) => {
        if (typeof from !== "number" || typeof to !== "number") throw new Error("from and to must be numbers");
        api.player.moveInQueue(from, to);
      },
      "player.addToQueue": ([videoId, position]) =>
        api.player.addToQueue(text(videoId, 20, "videoId"), position === "end" ? "end" : "next"),
      "settings.getAll": () => api.settings.getAll(),
      "settings.update": ([values]) => {
        if (typeof values !== "object" || values === null || Array.isArray(values)) {
          throw new Error("values must be an object");
        }
        // The API checks every value against the plugin's schema.
        return api.settings.update(values as Record<string, never>);
      },
      "ui.injectCss": ([css]) => keep(api.ui.injectCss(text(css, MAX_CSS_LENGTH, "css"))),
      "ui.removeCss": release,
      "ui.showNotice": ([message]) => api.ui.showNotice(text(message, MAX_NOTICE_LENGTH, "text")),
      "ui.addNavButton": ([label]) => {
        const handle = { id: 0 };
        handle.id = keep(
          api.ui.addNavButton(text(label, MAX_LABEL_LENGTH, "label"), () => {
            emit("buttonClick", { id: handle.id });
          }),
        );
        return handle.id;
      },
      "ui.removeNavButton": release,
      "ui.addShortcut": ([shortcut]) => {
        const handle = { id: 0 };
        handle.id = keep(
          api.ui.addShortcut(text(shortcut, MAX_SHORTCUT_LENGTH, "shortcut"), () => {
            emit("shortcutPress", { id: handle.id });
          }),
        );
        return handle.id;
      },
      "ui.removeShortcut": release,
      // The target's shape is checked where the navigation happens.
      "ui.navigate": ([target]) => {
        if (typeof target !== "object" || target === null) throw new Error("target must be an object");
        api.ui.navigate(target as NavigationTarget);
      },
      // The panel exists for every external plugin, because it holds the
      // iframe. Showing it is what needs the permission; reading `api.ui` checks it.
      "ui.showPanel": ([title]) => {
        void api.ui;
        ownPanel.setTitle(text(title ?? manifest.name, MAX_TITLE_LENGTH, "title"));
        ownPanel.show();
      },
      "ui.hidePanel": () => {
        void api.ui;
        ownPanel.hide();
      },
    };
  }

  return {
    manifest,

    onLoad(api) {
      const ownPanel = makePanel(manifest.name);
      panel = ownPanel;
      ownPanel.onClose(() => emit("panelClose"));

      const frame = doc.createElement("iframe");
      // The served document sandboxes itself as well; this covers the moment before it loads.
      frame.setAttribute("sandbox", "allow-scripts");
      frame.src = frameUrl;
      frameWindow = () => frame.contentWindow;

      const table = methods(api, ownPanel);
      const answer = async (id: number, method: string, args: unknown[]): Promise<void> => {
        try {
          const run = Object.hasOwn(table, method) ? table[method] : undefined;
          if (!run) throw new Error(`unknown method ${method}`);
          send({ ytmd: PROTOCOL, type: "result", id, ok: true, value: await run(args) });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          send({ ytmd: PROTOCOL, type: "result", id, ok: false, error: reason });
        }
      };

      onMessage = (event: MessageEvent) => {
        const message = event.data as FrameMessage | undefined;
        if (event.source !== frame.contentWindow || message?.ytmd !== PROTOCOL) return;
        if (message.type === "ready") {
          ready = true;
          for (const queuedMessage of queued.splice(0)) send(queuedMessage);
        } else if (message.type === "error") {
          log.error(`[ytm-desktop] plugin "${manifest.name}":`, String(message.message));
        } else if (typeof message.id === "number" && Array.isArray(message.args)) {
          void answer(message.id, String(message.method), message.args);
        }
      };
      doc.defaultView?.addEventListener("message", onMessage);
      // Moving an iframe reloads it. The panel is already in the page and stays put.
      ownPanel.body.appendChild(frame);
    },

    onUIReady: () => emit("uiReady"),
    onSongChange: (song) => emit("songChange", song),
    onPlaybackChange: (state) => emit("playbackChange", state),
    onSettingsChange: (values) => emit("settingsChange", values),

    onUnload() {
      // Removing the iframe stops the plugin's code for good.
      if (onMessage) doc.defaultView?.removeEventListener("message", onMessage);
      panel?.remove();
      panel = onMessage = frameWindow = undefined;
      ready = false;
      queued = [];
    },
  };
}

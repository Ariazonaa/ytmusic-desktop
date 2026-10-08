// Messages between a sandboxed plugin iframe and the injected script.
import type {
  JsonResponse,
  LikeStatus,
  NavigationTarget,
  NetRequest,
  NetResponse,
  PlaybackState,
  PluginSettingValues,
  QueueItem,
  SettingValue,
  Song,
} from "../shared/types";

/** Marks our messages among whatever else is posted to the windows involved. */
export const PROTOCOL = 1;

/** Sent by the iframe. */
export type FrameMessage =
  /** The plugin's script has run; queued events may be delivered. */
  | { ytmd: typeof PROTOCOL; type: "ready" }
  | { ytmd: typeof PROTOCOL; type: "call"; id: number; method: string; args: unknown[] }
  /** An uncaught error in the plugin, for the host's console. */
  | { ytmd: typeof PROTOCOL; type: "error"; message: string };

/** Sent by the injected script. */
export type HostMessage =
  | { ytmd: typeof PROTOCOL; type: "result"; id: number; ok: true; value: unknown }
  | { ytmd: typeof PROTOCOL; type: "result"; id: number; ok: false; error: string }
  | { ytmd: typeof PROTOCOL; type: "event"; name: string; payload: unknown };

export interface SandboxEvents {
  songChange: Song;
  playbackChange: PlaybackState;
  settingsChange: PluginSettingValues;
  uiReady: undefined;
  /** The user closed the plugin's panel with its close button. */
  panelClose: undefined;
}

/**
 * The global `ytmd` object an external plugin works with. It mirrors the
 * built-in plugin API, but every call crosses the sandbox boundary and
 * therefore returns a promise. Calls the manifest has no permission for reject.
 */
export interface SandboxApi {
  /** Subscribes to an event. Returns a function that unsubscribes. */
  on<K extends keyof SandboxEvents>(event: K, handler: (payload: SandboxEvents[K]) => void): () => void;
  /** The language the app's own buttons and panels are in. Needs no permission. */
  getLanguage(): Promise<"en" | "de">;
  /** Requires `music.read`. */
  music: {
    getCurrentSong(): Promise<Song | null>;
    getPlaybackState(): Promise<PlaybackState | null>;
    getVideoId(): Promise<string | null>;
    getLoudnessLkfs(): Promise<number | null>;
    getLikeStatus(): Promise<LikeStatus | null>;
    getQueue(): Promise<QueueItem[]>;
  };
  /** Requires `music.control`. */
  player: {
    seekTo(seconds: number): Promise<void>;
    /** 1 is normal speed. `preservePitch` defaults to true. */
    setPlaybackRate(rate: number, preservePitch?: boolean): Promise<void>;
    /** 0 to 100, as on the page's volume slider. */
    getVolume(): Promise<number | null>;
    setVolume(percent: number): Promise<number | null>;
    next(): Promise<void>;
    /** Changes the user's library, like a click on the thumbs. */
    setLikeStatus(status: LikeStatus): Promise<boolean>;
    addToQueue(videoId: string, position?: "next" | "end"): Promise<void>;
    removeFromQueue(index: number): Promise<void>;
    moveInQueue(from: number, to: number): Promise<void>;
  };
  /** Requires `network`. Only HTTPS and only the manifest's `hosts`. */
  net: {
    getJson(url: string): Promise<JsonResponse>;
    request(url: string, request?: NetRequest): Promise<NetResponse>;
  };
  /** Requires `notify`. */
  notify: {
    show(title: string, body?: string, options?: { imageUrl?: string | null; onClick?: () => void }): Promise<void>;
  };
  settings: {
    get(key: string): Promise<SettingValue | undefined>;
    getAll(): Promise<PluginSettingValues>;
    /** Changes and saves some of the plugin's own settings. Values must fit its schema. */
    update(values: PluginSettingValues): Promise<void>;
  };
  /** Requires `ui.inject`. The plugin cannot touch the page's DOM itself. */
  ui: {
    /** Adds CSS to the page. Resolves with a function that removes it. */
    injectCss(css: string): Promise<() => Promise<void>>;
    /** Shows a short message at the bottom of the window. */
    showNotice(text: string): Promise<void>;
    /** Adds a button to the navigation bar. Resolves with a function that removes it. */
    addNavButton(label: string, onClick: () => void): Promise<() => Promise<void>>;
    /**
     * Shows the plugin's own document as a panel at the right edge of the
     * window. Whatever the plugin puts into `document.body` appears there.
     * `title` defaults to the plugin's name.
     */
    showPanel(title?: string): Promise<void>;
    hidePanel(): Promise<void>;
    /** Registers a key combination for the app's window. Resolves with a function that removes it. */
    addShortcut(shortcut: string, onPress: () => void): Promise<() => Promise<void>>;
    navigate(target: NavigationTarget): Promise<void>;
  };
}

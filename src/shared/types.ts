/** What a plugin may ask for in the `permissions` list of its `plugin.json`. */
export const PERMISSIONS = ["music.read", "music.control", "ui.inject", "network", "audio", "notify"] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** What a plugin is about. The settings window groups plugins by it. */
export const PLUGIN_CATEGORIES = ["audio", "appearance", "playback", "tools"] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

export interface PluginManifest {
  /** Unique id, also used in `settings.json`. Lowercase letters, digits and `-`. */
  name: string;
  version: string;
  /** One or two sentences on what the plugin does, shown in the settings window. */
  description?: string;
  /** Where the settings window lists the plugin. Without one it is listed under tools. */
  category?: PluginCategory;
  permissions: Permission[];
  /** Hosts the plugin may contact over HTTPS. Required with the `network` permission. */
  hosts?: string[];
  /** Names of plugins this one cannot run together with. It applies in both directions. */
  conflicts?: string[];
  /** Settings the user can change in the settings window, keyed by setting name. */
  settings?: Record<string, SettingField>;
}

export type SettingValue = boolean | string | number;

interface SettingFieldBase {
  /** Shown next to the control in the settings window. */
  label: string;
  description?: string;
  /**
   * Keeps the setting out of the settings window. For values the plugin
   * edits through an interface of its own.
   */
  hidden?: boolean;
}

/** One entry of a plugin's settings schema. The type decides the control. */
export type SettingField =
  | (SettingFieldBase & { type: "boolean"; default: boolean })
  | (SettingFieldBase & { type: "string"; default: string })
  /** A multi-line text field, e.g. for CSS. */
  | (SettingFieldBase & { type: "text"; default: string })
  | (SettingFieldBase & { type: "number"; default: number; min?: number; max?: number })
  /** A slider. `unit` is shown after the value, e.g. "dB". */
  | (SettingFieldBase & {
      type: "range";
      default: number;
      min: number;
      max: number;
      step?: number;
      unit?: string;
    })
  | (SettingFieldBase & {
      type: "select";
      default: string;
      options: { value: string; label: string }[];
    })
  /** A color, stored like `#3b82f6`. */
  | (SettingFieldBase & { type: "color"; default: string })
  /** A key combination, stored like `Ctrl+Shift+KeyL`. Empty means none. See `UiApi.addShortcut`. */
  | (SettingFieldBase & { type: "shortcut"; default: string });

/** A plugin's effective settings: one value per field of its schema. */
export type PluginSettingValues = Record<string, SettingValue>;

/** Per-plugin settings as stored in `settings.json`, keyed by plugin name. */
export type StoredPluginSettings = Record<string, Record<string, SettingValue>>;

export interface Song {
  title: string;
  artist: string;
  album: string;
  /** URL of the largest available cover image. */
  artworkUrl: string | null;
}

/**
 * A snapshot of the player. Position does not update by itself: read it again
 * when needed. The position is that of the sound being heard.
 */
export interface PlaybackState {
  paused: boolean;
  positionSeconds: number;
  /** `null` while the track is still loading. */
  durationSeconds: number | null;
}

/** Mirrors `Settings` in `src-tauri/src/settings.rs`. */
export interface Settings {
  /** Names of the enabled plugins. */
  plugins: string[];
  /** Launch the app when the user signs in to the OS. */
  startup: boolean;
  /** Closing the window hides it to the tray instead of quitting. */
  minimizeToTray: boolean;
  /** When launched at sign-in, start in the tray without showing the window. */
  startInTray: boolean;
  /** Load the track that was playing when the app was closed, paused. */
  resumePlayback: boolean;
  /** Language of the settings window: `system`, `en` or `de`. */
  language: string;
  /** For plugin authors: reload the external plugins when a file in the plugins folder changes. */
  reloadPluginsOnChange: boolean;
  /** Draw and decode video on the GPU. Applies from the next start. */
  hardwareAcceleration: boolean;
  /** Only values the user changed are stored; the rest come from the schema defaults. */
  pluginSettings: StoredPluginSettings;
  shortcuts: Shortcuts;
}

/**
 * Key combinations that work while another program has the focus, written
 * like `Ctrl+Alt+ArrowUp`. An empty one is switched off.
 */
export interface Shortcuts {
  playPause: string;
  next: string;
  previous: string;
  volumeUp: string;
  volumeDown: string;
  toggleMute: string;
}

/** What the tray menu can ask the player to do. */
export type PlayerAction =
  | "playPause"
  | "next"
  | "previous"
  | "volumeUp"
  | "volumeDown"
  | "toggleMute";

/** How the user rated a track with the thumbs. */
export type LikeStatus = "like" | "dislike" | "none";

/** A button on a notice. */
export interface NoticeAction {
  label: string;
  onClick: () => void;
}

/** One track of the play queue, with its texts as the page shows them. */
export interface QueueItem {
  title: string;
  artist: string;
  /** As shown, e.g. `3:04`. */
  duration: string;
  videoId: string | null;
  /** The track that is playing. Those before it were played, those after it come next. */
  playing: boolean;
}

/** A page of YouTube Music to go to. */
export type NavigationTarget =
  | { type: "search"; query: string }
  /** Opens a track, which plays it. */
  | { type: "track"; videoId: string }
  /** A page by its id: an album (`MPREb_…`), an artist (`UC…`), a playlist (`VL…`) or e.g. `FEmusic_home`. */
  | { type: "page"; browseId: string };

/** What does not work at the moment, for the settings window. Mirrors `Health` in `src-tauri/src/health.rs`. */
export interface Health {
  /** Parts of YouTube Music's page the app could not find. */
  pageProblems: string[];
  /** The latest errors of each plugin, newest last. */
  pluginErrors: Record<string, string[]>;
}

/** Requires the `music.read` permission. */
export interface MusicApi {
  /** The song YouTube Music is currently playing, or `null` if there is none. */
  getCurrentSong(): Song | null;
  /** The live player state, or `null` before the player exists. */
  getPlaybackState(): PlaybackState | null;
  /** The YouTube video id of the current track, or `null` if nothing is loaded. */
  getVideoId(): string | null;
  /**
   * How loud the current track comes out of the player, in LKFS: about -7 for
   * a loud master, -20 for a quiet one. `null` if YouTube Music does not say.
   */
  getLoudnessLkfs(): number | null;
  /** How the user rated the current track, or `null` while the page has not said yet. */
  getLikeStatus(): LikeStatus | null;
  /** The play queue in order: played, playing and upcoming tracks. Empty before there is one. */
  getQueue(): QueueItem[];
}

/** Requires the `music.control` permission. */
export interface PlayerApi {
  /** Jumps to a position in the current track. */
  seekTo(seconds: number): void;
  /**
   * Sets the playback speed, 1 being normal. With `preservePitch` off, the
   * pitch rises and falls with the speed.
   */
  setPlaybackRate(rate: number, preservePitch: boolean): void;
  /** The volume on YouTube Music's slider, 0 to 100, or `null` before the player exists. */
  getVolume(): number | null;
  /** Sets the volume, 0 to 100, and returns the value that was applied. */
  setVolume(percent: number): number | null;
  /** Goes to the next track in the queue. */
  next(): void;
  /**
   * Rates the playing track, as a click on the thumbs does; `none` takes a
   * rating back. This changes the user's library. Returns `false` if the page
   * has no thumbs to press yet.
   */
  setLikeStatus(status: LikeStatus): boolean;
  /**
   * Adds a track to the play queue: right after the playing one (`next`, the
   * default) or behind everything queued (`end`). Rejects if YouTube Music
   * does not know the track or nothing has been played yet.
   */
  addToQueue(videoId: string, position?: "next" | "end"): Promise<void>;
  /**
   * Takes an upcoming track out of the play queue. `index` is its position
   * in `music.getQueue()`. Throws for the playing track, for tracks before it
   * and for a position that does not exist.
   */
  removeFromQueue(index: number): void;
  /**
   * Moves an upcoming track to another place among the upcoming ones. Both
   * are positions in `music.getQueue()`; `to` is where the track is afterwards.
   */
  moveInQueue(from: number, to: number): void;
}

/** A piece of the audio chain: sound enters at `input` and leaves at `output`. */
export interface AudioEffect {
  input: AudioNode;
  output: AudioNode;
}

/** Requires the `audio` permission. Built-in plugins only. */
export interface AudioApi {
  /**
   * The name of the device sound goes to, as the system shows it, e.g.
   * `Headphones (WH-1000XM4)`. `null` if it is not known.
   */
  getOutputDevice(): Promise<string | null>;
  /**
   * Calls `handler` when sound starts going to another device. Returns a
   * function that stops that; it also stops when the plugin unloads.
   */
  onOutputDeviceChange(handler: (device: string | null) => void): () => void;
  /**
   * Inserts an effect between the player and the speakers. `build` is called
   * once the audio context exists. Effects of all plugins run in ascending
   * `order`. Returns a function that removes the effect; it is also removed
   * when the plugin unloads.
   */
  addEffect(order: number, build: (context: AudioContext) => AudioEffect): () => void;
  /**
   * Tells the app that the sound is heard this many seconds of the track
   * after the player plays it, because an effect holds it back. Positions
   * reported to plugins then describe what is heard. It is set back to zero
   * when the plugin unloads.
   */
  setOutputDelay(seconds: number): void;
}

export interface JsonResponse {
  /** The HTTP status. Error statuses do not reject. */
  status: number;
  /** The parsed body, or `null` if it was not JSON. */
  data: unknown;
}

/** Requires the `network` permission. */
/** A request beyond a plain GET. */
export interface NetRequest {
  /** Default `GET`. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** E.g. `{ Authorization: "Token …", "Content-Type": "application/json" }`. */
  headers?: Record<string, string>;
  /** Text to send. For JSON, pass `JSON.stringify(…)` and set the content type. */
  body?: string | null;
}

export interface NetResponse {
  /** The HTTP status. Error statuses do not reject. */
  status: number;
  /** The answer as text. */
  text: string;
  /** The answer parsed as JSON, or `null` if it is not JSON. */
  data: unknown;
}

export interface NetApi {
  /**
   * Fetches JSON over HTTPS from one of the hosts listed in the manifest.
   * Sends no cookies and no referrer. Rejects for other hosts and on network errors.
   */
  getJson(url: string): Promise<JsonResponse>;
  /**
   * Makes a request with a method, headers and a body of the plugin's choice,
   * to the same hosts and under the same rules as `getJson`. Redirects are
   * not followed. The other server must allow requests from web pages (CORS).
   */
  request(url: string, request?: NetRequest): Promise<NetResponse>;
}

export interface NotifyOptions {
  /**
   * A picture to show, e.g. a song's `artworkUrl`. Only covers from
   * YouTube's image servers are shown; anything else is left out.
   */
  imageUrl?: string | null;
  /** Called when the notification is clicked. The app's window comes to the front either way. */
  onClick?: () => void;
}

/** Requires the `notify` permission. */
export interface NotifyApi {
  /**
   * Shows a notification of the operating system. Rejects if another one was
   * shown within the last three seconds. Picture and click work on Windows.
   */
  show(title: string, body?: string, options?: NotifyOptions): Promise<void>;
}

/** Requires the `ui.inject` permission. */
export interface UiApi {
  /**
   * Adds CSS to the page and returns a function that removes it again.
   * Anything still injected when the plugin unloads is removed automatically.
   */
  injectCss(css: string): () => void;
  /** Resolves with the first element matching `selector`, waiting for it to appear. */
  waitForElement(selector: string): Promise<Element>;
  /**
   * Shows a short message above the player bar for a few seconds. With an
   * `action` it carries a button and stays a little longer.
   */
  showNotice(text: string, action?: NoticeAction): void;
  /**
   * Calls `onPress` when the key combination is pressed while the app's
   * window has the focus, except while the user types in a field. Written
   * like `Ctrl+Shift+KeyL`: Ctrl, Alt, Shift and Super in that order, then the
   * key's code. A combination needs Ctrl, Alt or Super, or is a function key.
   * Throws for anything else. Returns a function that removes the shortcut;
   * it is also removed when the plugin unloads.
   */
  addShortcut(shortcut: string, onPress: () => void): () => void;
  /**
   * Goes to a page of YouTube Music without loading the site again, so the
   * music keeps playing. Throws for an invalid target.
   */
  navigate(target: NavigationTarget): void;
  /**
   * Adds a text button to the navigation bar and returns a function that
   * removes it. The button is also removed when the plugin unloads.
   */
  addNavButton(label: string, onClick: () => void): () => void;
  /**
   * Creates a hidden side panel with a title bar and a close button. It is
   * removed when the plugin unloads.
   */
  addPanel(title: string): Panel;
}

/**
 * A side panel at the right edge of the window. All panels share that place:
 * showing one closes the panel that is open.
 */
export interface Panel {
  /** Put the panel's content here. */
  readonly body: HTMLElement;
  readonly open: boolean;
  show(): void;
  hide(): void;
  /** `subtitle` appears dimmed after the title. */
  setTitle(title: string, subtitle?: string): void;
  /**
   * Registers a handler for the panel being closed by the user or by another
   * panel opening. It is not called for `hide()`.
   */
  onClose(handler: () => void): void;
  remove(): void;
}

/** What a file to share holds: a look for the themes plugin or an equalizer preset. */
export type SharedKind = "themes" | "equalizer";

/** A file to share from one of the user's folders: a name and some settings of a plugin. */
export interface SharedFile {
  /** The file name without `.json`. */
  file: string;
  name: string;
  /** Not checked against the plugin's schema yet. */
  settings: Record<string, unknown>;
}

/** A plugin found in the user's plugins folder, as reported by the backend. */
export interface ExternalPluginInfo {
  /** The folder name. */
  name: string;
  /** The parsed `plugin.json`, not validated yet. */
  manifest: unknown;
  /** The document to load in the plugin's sandboxed iframe. */
  frameUrl: string;
}

/** The plugin's own settings, as declared in its `plugin.json`. Needs no permission. */
export interface SettingsApi {
  /** The current value of a setting, or `undefined` if the schema has no such key. */
  get(key: string): SettingValue | undefined;
  getAll(): PluginSettingValues;
  /**
   * Changes some of the plugin's settings and saves them, as if the user had
   * changed them in the settings window. Rejects for keys the schema does not
   * have and for values that do not fit it. `onSettingsChange` follows.
   */
  update(values: PluginSettingValues): Promise<void>;
}

/**
 * Handed to a plugin in `onLoad`. Reading a namespace the plugin has no
 * permission for throws a `PermissionError`.
 */
export interface PluginApi {
  readonly music: MusicApi;
  readonly player: PlayerApi;
  readonly audio: AudioApi;
  readonly ui: UiApi;
  readonly net: NetApi;
  readonly notify: NotifyApi;
  readonly settings: SettingsApi;
}

/**
 * A plugin runs inside the YouTube Music page. All hooks are optional. A hook
 * that throws gets its plugin unloaded; other plugins keep running.
 */
export interface Plugin {
  manifest: PluginManifest;
  /** Called once when the plugin is enabled, before the page has rendered. */
  onLoad?(api: PluginApi): void;
  /** Called when the plugin is disabled. Undo DOM changes here. */
  onUnload?(): void;
  /** Called once per song change. Requires `music.read`. */
  onSongChange?(song: Song): void;
  /**
   * Called when playback starts, pauses, seeks or learns the track's duration.
   * Not called as the position advances. Requires `music.read`.
   */
  onPlaybackChange?(state: PlaybackState): void;
  /** Called when the user changes one of the plugin's settings. */
  onSettingsChange?(values: PluginSettingValues): void;
  /** Called once the YouTube Music navigation bar exists. */
  onUIReady?(): void;
}

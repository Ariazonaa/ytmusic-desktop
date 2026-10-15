// Types of the `ytmd` object that external plugins work with. This file is
// only for your editor: the app does not read it. `ytmd.d.ts` next to it
// makes `ytmd` known as a global.
//
// The app's build checks these types against the real API
// (src/sandbox/ytmd-types.check.ts), so they cannot drift apart unnoticed.

export interface Song {
  title: string;
  artist: string;
  album: string;
  /** URL of the largest available cover image. */
  artworkUrl: string | null;
}

/** A snapshot of the player. Read it again when you need a newer one. */
export interface PlaybackState {
  paused: boolean;
  /** Seconds into the current track, of the sound being heard. */
  positionSeconds: number;
  /** Length of the current track, or `null` while it is still loading. */
  durationSeconds: number | null;
}

export type SettingValue = boolean | string | number;
/** One value per setting declared in `plugin.json`. */
export type SettingValues = Record<string, SettingValue>;

export interface JsonResponse {
  /** The HTTP status. Error statuses do not reject. */
  status: number;
  /** The parsed body, or `null` if it was not JSON. */
  data: unknown;
}

/** How the user rated a track with the thumbs. */
export type LikeStatus = "like" | "dislike" | "none";

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

export interface Events {
  /** Another song started. Needs `music.read`. */
  songChange: Song;
  /** Playback started, paused, seeked or learned the track's length. Needs `music.read`. */
  playbackChange: PlaybackState;
  /** The user, or the plugin itself, changed the plugin's settings. */
  settingsChange: SettingValues;
  /** YouTube Music's navigation bar exists. */
  uiReady: undefined;
  /** The user closed the plugin's panel, or another panel took its place. */
  panelClose: undefined;
}

/** Every call crosses the sandbox boundary, so everything returns a promise. */
export interface Ytmd {
  /** Subscribes to an event. Returns a function that unsubscribes. */
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void;

  /**
   * The language the app's own buttons and panels are in, for a plugin that
   * wants to match it. It follows the user's setting; the plugin is started
   * again when the setting changes.
   */
  getLanguage(): Promise<"en" | "de">;

  /** Needs the `music.read` permission. */
  music: {
    getCurrentSong(): Promise<Song | null>;
    getPlaybackState(): Promise<PlaybackState | null>;
    /** The YouTube video id of the current track. */
    getVideoId(): Promise<string | null>;
    /** How loud the current track is, in LKFS: about -7 for a loud master, -20 for a quiet one. */
    getLoudnessLkfs(): Promise<number | null>;
    /** How the user rated the current track, or `null` while the page has not said yet. */
    getLikeStatus(): Promise<LikeStatus | null>;
    /** The play queue in order: played, playing and upcoming tracks. */
    getQueue(): Promise<QueueItem[]>;
  };

  /** Needs the `music.control` permission. */
  player: {
    /** Jumps to a position in the current track. */
    seekTo(seconds: number): Promise<void>;
    /** 1 is normal speed. `preservePitch` defaults to true. */
    setPlaybackRate(rate: number, preservePitch?: boolean): Promise<void>;
    /** 0 to 100, as on YouTube Music's volume slider. */
    getVolume(): Promise<number | null>;
    /** Resolves with the volume that was applied. */
    setVolume(percent: number): Promise<number | null>;
    /** Goes to the next track in the queue. */
    next(): Promise<void>;
    /**
     * Rates the playing track, as a click on the thumbs does; `none` takes a
     * rating back. This changes the user's library. Resolves with `false` if
     * the page has no thumbs to press yet.
     */
    setLikeStatus(status: LikeStatus): Promise<boolean>;
    /**
     * Adds a track to the play queue: right after the playing one (`next`,
     * the default) or behind everything queued (`end`). Rejects if YouTube
     * Music does not know the track or nothing has been played yet.
     */
    addToQueue(videoId: string, position?: "next" | "end"): Promise<void>;
    /**
     * Takes an upcoming track out of the play queue. `index` is its position
     * in `music.getQueue()`. Rejects for the playing track, for tracks before
     * it and for a position that does not exist.
     */
    removeFromQueue(index: number): Promise<void>;
    /**
     * Moves an upcoming track to another place among the upcoming ones. Both
     * are positions in `music.getQueue()`; `to` is where the track is afterwards.
     */
    moveInQueue(from: number, to: number): Promise<void>;
  };

  /** Needs the `network` permission. */
  net: {
    /**
     * Fetches JSON over HTTPS from a host listed under `hosts` in
     * `plugin.json`. Sends no cookies and no referrer. Rejects for other
     * hosts and on network errors.
     */
    getJson(url: string): Promise<JsonResponse>;
    /**
     * Makes a request with a method, headers and a body of your choice, to the
     * same hosts and under the same rules as `getJson`. Redirects are not
     * followed. The other server must allow requests from web pages (CORS).
     */
    request(url: string, request?: NetRequest): Promise<NetResponse>;
  };

  /** Needs the `notify` permission. */
  notify: {
    /**
     * Shows a notification of the operating system. Rejects if another one
     * was shown within the last three seconds. `imageUrl` takes a cover, e.g.
     * a song's `artworkUrl`; other addresses are left out. `onClick` is
     * called when the notification is clicked. Picture and click work on Windows.
     */
    show(title: string, body?: string, options?: { imageUrl?: string | null; onClick?: () => void }): Promise<void>;
  };

  /** The plugin's own settings. Needs no permission. */
  settings: {
    get(key: string): Promise<SettingValue | undefined>;
    getAll(): Promise<SettingValues>;
    /** Changes and saves settings. Rejects values that do not fit the schema. */
    update(values: SettingValues): Promise<void>;
  };

  /** Needs the `ui.inject` permission. */
  ui: {
    /** Adds CSS to the YouTube Music page. Resolves with a function that removes it. */
    injectCss(css: string): Promise<() => Promise<void>>;
    /** Shows a short message above the player bar. At most 200 characters. */
    showNotice(text: string): Promise<void>;
    /** Adds a button to the navigation bar. Resolves with a function that removes it. */
    addNavButton(label: string, onClick: () => void): Promise<() => Promise<void>>;
    /**
     * Shows the plugin's own document as a panel at the right edge of the
     * window. `title` defaults to the plugin's name.
     */
    showPanel(title?: string): Promise<void>;
    hidePanel(): Promise<void>;
    /**
     * Calls `onPress` when the key combination is pressed while the app's
     * window has the focus, except while the user types in a field. Written
     * like `Ctrl+Shift+KeyL`: Ctrl, Alt, Shift and Super in that order, then
     * the key's code. Needs Ctrl, Alt or Super, or a function key. Resolves
     * with a function that removes the shortcut.
     */
    addShortcut(shortcut: string, onPress: () => void): Promise<() => Promise<void>>;
    /** Goes to a page of YouTube Music without interrupting the music. */
    navigate(target: NavigationTarget): Promise<void>;
  };
}

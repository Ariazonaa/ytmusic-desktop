import { invoke } from "@tauri-apps/api/core";
import type { AssertionParts, GetRequest } from "../injector/webauthn";
import type {
  ExternalPluginInfo,
  MarketEntry,
  Health,
  PluginSettingValues,
  Settings,
  SharedFile,
  SharedKind,
  UpdateInfo,
} from "../../shared/types";

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

/** Opens the app's settings window. */
export function openSettings(): Promise<void> {
  return invoke("open_settings");
}

/**
 * Changes the given top-level settings and keeps the rest as the backend has
 * them now. Resolves with all settings as saved; rejects if the backend refuses
 * them, e.g. because of an invalid plugin name. Settings window only.
 */
export function updateSettings(changes: Partial<Omit<Settings, "pluginSettings">>): Promise<Settings> {
  return invoke<Settings>("update_settings", { changes });
}

/**
 * Changes some settings of one plugin; with `replace`, the plugin keeps only
 * `values`. Resolves with all settings as saved.
 */
export function updatePluginSettings(
  plugin: string,
  values: PluginSettingValues,
  replace = false,
): Promise<Settings> {
  return invoke<Settings>("update_plugin_settings", { plugin, values, replace });
}

/** The plugins found in the user's plugins folder. Their manifests are not validated yet. */
export function listExternalPlugins(): Promise<ExternalPluginInfo[]> {
  return invoke<ExternalPluginInfo[]>("list_external_plugins");
}

/**
 * Makes the main window read the plugins folder again and restart the external
 * plugins. Only the settings window may call this.
 */
export function reloadPlugins(): Promise<void> {
  return invoke("reload_plugins");
}

/** The files to share of one kind in the user's folder for them. */
export function listShared(kind: SharedKind): Promise<SharedFile[]> {
  return invoke<SharedFile[]>("list_shared", { kind });
}

/** Writes a file to share, replacing one of the same name. Resolves with its file name. */
export function saveShared(kind: SharedKind, name: string, settings: PluginSettingValues): Promise<string> {
  return invoke<string>("save_shared", { kind, name, settings });
}

/** Shows the folder for files to share of one kind in the file manager. */
export function openSharedFolder(kind: SharedKind): Promise<void> {
  return invoke("open_shared_folder", { kind });
}

/** Shows the tray what is playing. An empty title means nothing is. */
export function setNowPlaying(title: string, artist: string, cover: string | null): Promise<void> {
  return invoke("set_now_playing", { title, artist, cover });
}

/** The sleep timer's "at the end of the track" has paused. */
export function sleepDone(): Promise<void> {
  return invoke("sleep_done");
}

/** What plays, for the taskbar's play / pause button and progress. */
export function setPlayback(paused: boolean, position: number, duration: number | null): Promise<void> {
  return invoke("set_playback", { paused, position, duration });
}

/** Adds a line to the app's log file. The backend bounds and counts these. */
export function logError(message: string): Promise<void> {
  return invoke("log_error", { message });
}

/** Shows a notification of the operating system. The backend refuses them in quick succession. */
export function notify(
  title: string,
  body = "",
  /** A PNG or JPEG file in base64. */
  image: string | null = null,
  /** Comes back through `notificationClicked` when the notification is clicked. */
  clickId: number | null = null,
): Promise<void> {
  return invoke("notify", { title, body, image, clickId });
}

/** Tells the backend what does not work at the moment. It replaces the last report. */
export function reportHealth(health: Health): Promise<void> {
  return invoke("report_health", { health });
}

/** What does not work at the moment. Settings window only. */
export function getHealth(): Promise<Health> {
  return invoke<Health>("get_health");
}

/** Whether the app runs for the first time. Settings window only. */
export function isFirstRun(): Promise<boolean> {
  return invoke<boolean>("is_first_run");
}

/**
 * Asks for a zip file and installs the plugin in it, replacing one of the
 * same name. Resolves with the plugin's name, or `null` if the dialog was
 * cancelled. Settings window only.
 */
export function installPlugin(): Promise<string | null> {
  return invoke<string | null>("install_plugin");
}

/**
 * Asks where to and saves the cover at `url` (YouTube's image servers only)
 * as a picture named after `name`. Resolves with whether it was saved.
 */
export function saveCover(url: string, name: string): Promise<boolean> {
  return invoke<boolean>("save_cover", { url, name });
}

/** Writes the playing track to the now-playing files, and fetches its cover for them. */
export function nowPlayingUpdate(
  text: string,
  track: { title: string; artist: string; album: string; paused: boolean },
  coverUrl: string | null,
): Promise<void> {
  return invoke("now_playing_update", { text, track, coverUrl });
}

/** Serves the now-playing page on 127.0.0.1 at `port`, or stops it with `null`. */
export function nowPlayingServe(port: number | null): Promise<void> {
  return invoke("now_playing_serve", { port });
}

/** Shows the now-playing folder in the file manager. */
export function openNowPlayingFolder(): Promise<void> {
  return invoke("open_now_playing_folder");
}

/** What the listening statistics say. Mirrors `Summary` in `src-tauri/src/stats.rs`. */
export interface StatsSummary {
  topTracks: { title: string; artist: string; plays: number; seconds: number }[];
  topArtists: [name: string, counts: { plays: number; seconds: number }][];
  days: [day: string, seconds: number][];
  totalSeconds: number;
  totalPlays: number;
}

/** Adds what was heard of a track to the listening statistics. */
export function statsRecord(heard: {
  videoId: string;
  title: string;
  artist: string;
  seconds: number;
  day: string;
}): Promise<void> {
  return invoke("stats_record", { heard });
}

/** The listening statistics, with the last `days` days. */
export function statsSummary(days: number): Promise<StatsSummary> {
  return invoke<StatsSummary>("stats_summary", { days });
}

/** Forgets all listening statistics. */
export function statsClear(): Promise<void> {
  return invoke("stats_clear");
}

/**
 * Asks where to and saves `text` as a file named after `name`, of the kind
 * `txt` or `csv`. Resolves with whether it was saved.
 */
export function saveText(name: string, kind: "txt" | "csv", text: string): Promise<boolean> {
  return invoke<boolean>("save_text", { name, kind, text });
}

/** Shows or closes the lyrics window over other programs. */
export function lyricsOverlay(show: boolean): Promise<void> {
  return invoke("lyrics_overlay", { show });
}

/** Hands the line being sung and the next one to the lyrics window. */
export function lyricsOverlayLine(line: string, next: string): Promise<void> {
  return invoke("lyrics_overlay_line", { line, next });
}

/** Opens an HTTPS address in the user's browser. At most one a second. */
export function openLink(url: string): Promise<void> {
  return invoke("open_link", { url });
}

/** Asks a security key to sign in. Google sign-in page only, Linux only. */
export function webAuthnGet(request: GetRequest): Promise<AssertionParts> {
  return invoke<AssertionParts>("webauthn_get", { request });
}

/** Cancels the request of `webAuthnGet`. */
export function webAuthnCancel(): Promise<void> {
  return invoke("webauthn_cancel");
}

/** Fetches the public list of plugins from others. Settings window only. */
export function marketplaceList(): Promise<MarketEntry[]> {
  return invoke<MarketEntry[]>("marketplace_list");
}

/** Installs a plugin from the list fetched last, without switching it on. Resolves with its name. Settings window only. */
export function marketplaceInstall(name: string): Promise<string> {
  return invoke<string>("marketplace_install", { name });
}

/** Opens the project's page in the browser. Settings window only. */
export function openRepository(): Promise<void> {
  return invoke("open_repository");
}

/** Opens the homepage of a plugin from the list fetched last. Settings window only. */
export function marketplaceOpenHomepage(name: string): Promise<void> {
  return invoke("marketplace_open_homepage", { name });
}

/** Deletes an external plugin and switches it off. Resolves with the settings after that. Settings window only. */
export function removePlugin(name: string): Promise<Settings> {
  return invoke<Settings>("remove_plugin", { name });
}

/** The name of the device sound currently goes to, or `null` if it is not known. */
export function getOutputDevice(): Promise<string | null> {
  return invoke<string | null>("output_device");
}

/** Opens the log file. Settings window only. */
export function openLog(): Promise<void> {
  return invoke("open_log");
}

/** Asks where to and writes the settings there. `false` if the dialog was cancelled. Settings window only. */
export function exportSettings(): Promise<boolean> {
  return invoke<boolean>("export_settings");
}

/** Asks for a settings file and applies it. `null` if the dialog was cancelled. Settings window only. */
export function importSettings(): Promise<Settings | null> {
  return invoke<Settings | null>("import_settings");
}

/** Whether a setting was changed that only applies after a restart. Settings window only. */
export function restartRequired(): Promise<boolean> {
  return invoke<boolean>("restart_required");
}

/** Quits the app and starts it again. Settings window only. */
export function restartApp(): Promise<void> {
  return invoke("restart_app");
}

/** The version of the running app. Settings window only. */
export function appVersion(): Promise<string> {
  return invoke<string>("app_version");
}

/** The folder a portable copy keeps everything in, or null. Settings window only. */
export function portableFolder(): Promise<string | null> {
  return invoke<string | null>("portable_folder");
}

/** The update the last check found, without asking again. Settings window only. */
export function pendingUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("pending_update");
}

/** Asks the project's releases for a newer version; `null` means this is the newest. Settings window only. */
export function checkUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("check_update");
}

/** Installs the update the last check found. The app then starts again as the new version. Settings window only. */
export function installUpdate(): Promise<void> {
  return invoke("install_update");
}

/** Shows the plugins folder in the file manager. Only the settings window may call this. */
export function openPluginsFolder(): Promise<void> {
  return invoke("open_plugins_folder");
}

/** What the Discord status shows; the backend checks and shortens it. Mirrors `ActivityRequest` in `discord.rs`. */
export interface DiscordActivity {
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
  /** Milliseconds since 1970, for Discord's progress bar. */
  startMs: number | null;
  endMs: number | null;
  videoId: string | null;
  paused: boolean;
  /** What the member list names after "Listening to": `app`, `artist` or `title`. */
  display: string;
  showCover: boolean;
  showProgress: boolean;
  showLinks: boolean;
  /** Text of the small icon on the cover; `null` leaves the icon out. */
  smallText: string | null;
  /** Texts of the buttons; `null` leaves a button out. */
  listenLabel: string | null;
  appLabel: string | null;
}

/** Shows in the user's Discord profile what is playing. Does nothing while Discord is not running. */
export function discordSetActivity(activity: DiscordActivity): Promise<void> {
  return invoke("discord_set_activity", { activity });
}

/** Takes the status out of Discord. */
export function discordClearActivity(): Promise<void> {
  return invoke("discord_clear_activity");
}

/** The status as Discord gets it, checked by the backend. */
export interface DiscordPreview {
  status_display_type: number;
  details: string;
  details_url?: string;
  state: string;
  state_url?: string;
  timestamps?: { start: number; end?: number };
  assets: { large_image?: string; large_text?: string; small_image?: string; small_text?: string };
  buttons?: { label: string; url: string }[];
}

/**
 * What Discord was last asked to show, or `sample` as Discord would get it
 * while nothing is shown. Settings window only.
 */
export function discordPreview(sample: DiscordActivity | null): Promise<DiscordPreview | null> {
  return invoke<DiscordPreview | null>("discord_preview", { sample });
}

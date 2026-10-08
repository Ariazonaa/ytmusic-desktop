import { invoke } from "@tauri-apps/api/core";
import type {
  ExternalPluginInfo,
  Health,
  PluginSettingValues,
  Settings,
  SharedFile,
  SharedKind,
} from "../../shared/types";

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

/** Opens the app's settings window. */
export function openSettings(): Promise<void> {
  return invoke("open_settings");
}

/** Rejects if the backend refuses the settings, e.g. because of an invalid plugin name. */
export function setSettings(settings: Settings): Promise<void> {
  return invoke("set_settings", { settings });
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
export function setNowPlaying(title: string, artist: string): Promise<void> {
  return invoke("set_now_playing", { title, artist });
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

/** Shows the plugins folder in the file manager. Only the settings window may call this. */
export function openPluginsFolder(): Promise<void> {
  return invoke("open_plugins_folder");
}

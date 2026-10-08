import type {
  PlaybackState,
  Plugin,
  PluginSettingValues,
  Song,
  StoredPluginSettings,
} from "../../shared/types";
import { conflict, createApi, resolveSettings, type Services } from "./api";

interface ActivePlugin {
  plugin: Plugin;
  /** The plugin's effective settings, see `resolveSettings`. */
  settings: PluginSettingValues;
  dispose: () => void;
}

type Logger = Pick<Console, "warn" | "error">;

/** Owns the lifecycle of the enabled plugins and fans events out to them. */
export class PluginManager {
  private readonly available = new Map<string, Plugin>();
  private readonly active = new Map<string, ActivePlugin>();
  /** Names of the plugins set through `setExternalPlugins`. */
  private readonly external = new Set<string>();
  private stored: StoredPluginSettings = {};
  private uiReady = false;

  constructor(
    plugins: readonly Plugin[],
    private readonly services: Services,
    private readonly log: Logger = console,
  ) {
    for (const plugin of plugins) this.available.set(plugin.manifest.name, plugin);
  }

  get activeNames(): string[] {
    return [...this.active.keys()];
  }

  /**
   * Replaces the plugins from the user's plugins folder. The previous ones are
   * unloaded, so their code is loaded afresh when they are enabled again.
   * A plugin that would shadow a built-in one is ignored.
   */
  setExternalPlugins(plugins: readonly Plugin[]): void {
    for (const name of this.external) {
      this.unload(name);
      this.available.delete(name);
    }
    this.external.clear();
    for (const plugin of plugins) {
      const name = plugin.manifest.name;
      if (this.available.has(name)) continue;
      this.available.set(name, plugin);
      this.external.add(name);
    }
  }

  /** Loads the named plugins. Unknown names are skipped with a warning. */
  enable(names: readonly string[]): void {
    for (const name of names) {
      const plugin = this.available.get(name);
      if (!plugin) {
        this.log.warn(`[ytm-desktop] unknown plugin "${name}" in settings`);
        continue;
      }
      if (this.active.has(name)) continue;
      const rival = [...this.active.values()].find((other) =>
        conflict(other.plugin.manifest, plugin.manifest),
      );
      if (rival) {
        const rivalName = rival.plugin.manifest.name;
        this.log.warn(
          `[ytm-desktop] not loading "${name}": it cannot run together with "${rivalName}"`,
        );
        continue;
      }
      const entry: ActivePlugin = {
        plugin,
        settings: resolveSettings(plugin.manifest, this.stored[name]),
        dispose: () => {},
      };
      const { api, dispose } = createApi(plugin.manifest, this.services, () => entry.settings);
      entry.dispose = dispose;
      this.active.set(name, entry);
      this.call(name, "onLoad", () => plugin.onLoad?.(api));
      if (this.uiReady) this.call(name, "onUIReady", () => plugin.onUIReady?.());
    }
  }

  /** Makes exactly the named plugins active: loads the missing ones, unloads the rest. */
  setEnabled(names: readonly string[]): void {
    for (const name of [...this.active.keys()]) {
      if (!names.includes(name)) this.unload(name);
    }
    this.enable(names);
  }

  /**
   * Takes the per-plugin settings from `settings.json`. Active plugins whose
   * effective settings changed get `onSettingsChange`.
   */
  setPluginSettings(stored: StoredPluginSettings): void {
    this.stored = stored;
    for (const [name, entry] of [...this.active]) {
      const next = resolveSettings(entry.plugin.manifest, stored[name]);
      if (sameValues(entry.settings, next)) continue;
      entry.settings = next;
      this.call(name, "onSettingsChange", () => entry.plugin.onSettingsChange?.({ ...next }));
    }
  }

  notifyUIReady(): void {
    this.uiReady = true;
    for (const [name, { plugin }] of [...this.active]) {
      this.call(name, "onUIReady", () => plugin.onUIReady?.());
    }
  }

  notifySongChange(song: Song): void {
    for (const [name, plugin] of this.musicReaders()) {
      this.call(name, "onSongChange", () => plugin.onSongChange?.(song));
    }
  }

  notifyPlaybackChange(state: PlaybackState): void {
    for (const [name, plugin] of this.musicReaders()) {
      this.call(name, "onPlaybackChange", () => plugin.onPlaybackChange?.(state));
    }
  }

  unloadAll(): void {
    for (const name of [...this.active.keys()]) this.unload(name);
  }

  private musicReaders(): [string, Plugin][] {
    return [...this.active]
      .filter(([, { plugin }]) => plugin.manifest.permissions.includes("music.read"))
      .map(([name, { plugin }]) => [name, plugin]);
  }

  private unload(name: string): void {
    const entry = this.active.get(name);
    if (!entry) return;
    this.active.delete(name);
    try {
      entry.plugin.onUnload?.();
    } catch (error) {
      this.log.error(`[ytm-desktop] plugin "${name}" failed in onUnload`, error);
      this.services.reportPluginError?.(name, `failed in onUnload: ${describe(error)}`);
    }
    entry.dispose();
  }

  /** Runs a hook; a plugin whose hook throws is unloaded so it cannot break the rest. */
  private call(name: string, hook: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.log.error(`[ytm-desktop] plugin "${name}" failed in ${hook}, disabling it`, error);
      this.services.reportPluginError?.(name, `failed in ${hook} and was switched off: ${describe(error)}`);
      this.unload(name);
    }
  }
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function sameValues(a: PluginSettingValues, b: PluginSettingValues): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

import {
  PERMISSIONS,
  type AudioApi,
  type MusicApi,
  type NetApi,
  type Permission,
  type PlayerApi,
  type PluginApi,
  type PluginManifest,
  type PluginSettingValues,
  type SettingField,
  type SettingValue,
  type SettingsApi,
  type UiApi,
  type NetRequest,
  type NetResponse,
  type NotifyApi,
  PLUGIN_CATEGORIES,
  type PluginCategory,
} from "../../shared/types";
import { isShortcut } from "../../shared/shortcut";
import { checkRequest } from "../net/json";

export class PermissionError extends Error {
  constructor(plugin: string, permission: Permission) {
    super(`plugin "${plugin}" lacks the "${permission}" permission`);
    this.name = "PermissionError";
  }
}

/** The real implementations behind the plugin API, shared by all plugins. */
export interface Services {
  music: MusicApi;
  player: PlayerApi;
  audio: AudioApi;
  ui: UiApi;
  /** Saves changed settings of the named plugin. `createApi` checks them against the schema first. */
  saveSettings(plugin: string, values: PluginSettingValues): Promise<void>;
  /** Unrestricted; `createApi` limits each plugin to the hosts in its manifest and checks its requests. */
  net: { getJson: NetApi["getJson"]; request(url: string, request: Required<NetRequest>): Promise<NetResponse> };
  notify: NotifyApi;
  /** Told when a plugin failed, for the settings window. */
  reportPluginError?(plugin: string, message: string): void;
}

const NAME_PATTERN = /^[a-z0-9-]{1,64}$/;
const MAX_DESCRIPTION_LENGTH = 300;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
/** A shortcut setting holds a key combination or nothing. */
const isShortcutValue = (value: unknown): value is string => value === "" || (typeof value === "string" && isShortcut(value));
const HOST_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
// Mirrors `is_valid_setting_key` in `src-tauri/src/settings.rs`.
const SETTING_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether two plugins cannot run together. Either one saying so is enough. */
export function conflict(a: PluginManifest, b: PluginManifest): boolean {
  return Boolean(a.conflicts?.includes(b.name) || b.conflicts?.includes(a.name));
}

/** Validates the contents of a `plugin.json`. */
export function parseManifest(json: unknown): PluginManifest {
  if (typeof json !== "object" || json === null) {
    throw new Error("plugin manifest must be an object");
  }
  const { name, version, description, category, permissions, hosts, conflicts, settings } = json as Record<
    string,
    unknown
  >;
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    throw new Error(`invalid plugin name: ${JSON.stringify(name)}`);
  }
  if (typeof version !== "string" || version === "") {
    throw new Error(`plugin "${name}" has no version`);
  }
  if (!Array.isArray(permissions)) {
    throw new Error(`plugin "${name}" has no permissions list`);
  }
  for (const permission of permissions) {
    if (!(PERMISSIONS as readonly unknown[]).includes(permission)) {
      throw new Error(`plugin "${name}" requests unknown permission ${JSON.stringify(permission)}`);
    }
  }
  const manifest: PluginManifest = { name, version, permissions: permissions as Permission[] };
  if (description !== undefined) {
    if (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH) {
      throw new Error(`plugin "${name}": description must be a text of at most ${MAX_DESCRIPTION_LENGTH} characters`);
    }
    manifest.description = description;
  }
  if (category !== undefined) {
    if (!(PLUGIN_CATEGORIES as readonly unknown[]).includes(category)) {
      throw new Error(`plugin "${name}": category must be one of ${PLUGIN_CATEGORIES.join(", ")}`);
    }
    manifest.category = category as PluginCategory;
  }
  if (hosts !== undefined) {
    const valid =
      Array.isArray(hosts) &&
      hosts.every((host) => typeof host === "string" && HOST_PATTERN.test(host));
    if (!valid) throw new Error(`plugin "${name}": hosts must be a list of host names`);
    manifest.hosts = hosts as string[];
  }
  if (conflicts !== undefined) {
    const valid =
      Array.isArray(conflicts) &&
      conflicts.every((other) => typeof other === "string" && NAME_PATTERN.test(other));
    if (!valid) throw new Error(`plugin "${name}": conflicts must be a list of plugin names`);
    manifest.conflicts = conflicts as string[];
  }
  if (manifest.permissions.includes("network") && !manifest.hosts?.length) {
    throw new Error(`plugin "${name}" requests network access without listing hosts`);
  }
  if (settings !== undefined) manifest.settings = parseSettingsSchema(name, settings);
  return manifest;
}

function parseSettingsSchema(plugin: string, json: unknown): Record<string, SettingField> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new Error(`plugin "${plugin}": settings must be an object`);
  }
  const schema: Record<string, SettingField> = {};
  for (const [key, field] of Object.entries(json)) {
    if (!SETTING_KEY_PATTERN.test(key)) {
      throw new Error(`plugin "${plugin}": invalid setting key ${JSON.stringify(key)}`);
    }
    schema[key] = parseField(`plugin "${plugin}", setting "${key}"`, field);
  }
  return schema;
}

function parseField(where: string, json: unknown): SettingField {
  if (typeof json !== "object" || json === null) throw new Error(`${where}: must be an object`);
  const { type, label, description, default: fallback, min, max, options } = json as Record<
    string,
    unknown
  >;
  if (typeof label !== "string" || label === "") throw new Error(`${where}: missing label`);
  if (description !== undefined && typeof description !== "string") {
    throw new Error(`${where}: description must be a string`);
  }
  const { hidden } = json as Record<string, unknown>;
  if (hidden !== undefined && typeof hidden !== "boolean") {
    throw new Error(`${where}: hidden must be true or false`);
  }
  const base: { label: string; description?: string; hidden?: boolean } = { label };
  if (description !== undefined) base.description = description;
  if (hidden !== undefined) base.hidden = hidden;

  switch (type) {
    case "boolean":
      if (typeof fallback !== "boolean") throw new Error(`${where}: default must be a boolean`);
      return { ...base, type, default: fallback };
    case "string":
    case "text":
      if (typeof fallback !== "string") throw new Error(`${where}: default must be a string`);
      return { ...base, type, default: fallback };
    case "number": {
      if (!isFiniteNumber(fallback)) throw new Error(`${where}: default must be a number`);
      const field: SettingField = { ...base, type, default: fallback };
      if (min !== undefined) {
        if (!isFiniteNumber(min)) throw new Error(`${where}: min must be a number`);
        field.min = min;
      }
      if (max !== undefined) {
        if (!isFiniteNumber(max)) throw new Error(`${where}: max must be a number`);
        field.max = max;
      }
      return field;
    }
    case "range": {
      const { step, unit } = json as Record<string, unknown>;
      if (!isFiniteNumber(min) || !isFiniteNumber(max) || !(max > min)) {
        throw new Error(`${where}: range needs min and max, with max above min`);
      }
      if (!isFiniteNumber(fallback) || fallback < min || fallback > max) {
        throw new Error(`${where}: default must be a number between min and max`);
      }
      const field: SettingField = { ...base, type, default: fallback, min, max };
      if (step !== undefined) {
        if (!isFiniteNumber(step) || step <= 0) throw new Error(`${where}: step must be positive`);
        field.step = step;
      }
      if (unit !== undefined) {
        if (typeof unit !== "string") throw new Error(`${where}: unit must be a string`);
        field.unit = unit;
      }
      return field;
    }
    case "select": {
      if (!Array.isArray(options) || options.length === 0) {
        throw new Error(`${where}: select needs options`);
      }
      const parsed = options.map((option: unknown) => {
        const { value, label: optionLabel } = (option ?? {}) as Record<string, unknown>;
        if (typeof value !== "string" || typeof optionLabel !== "string") {
          throw new Error(`${where}: options need a string value and label`);
        }
        return { value, label: optionLabel };
      });
      if (!parsed.some((option) => option.value === fallback)) {
        throw new Error(`${where}: default must be one of the options`);
      }
      return { ...base, type, default: fallback as string, options: parsed };
    }
    case "color":
      if (typeof fallback !== "string" || !COLOR_PATTERN.test(fallback)) {
        throw new Error(`${where}: default must be a color like #3b82f6`);
      }
      return { ...base, type, default: fallback };
    case "shortcut":
      if (!isShortcutValue(fallback)) {
        throw new Error(`${where}: default must be a shortcut like Ctrl+Shift+KeyL, or empty`);
      }
      return { ...base, type, default: fallback };
    default:
      throw new Error(`${where}: unknown type ${JSON.stringify(type)}`);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The effective settings of a plugin: one value per field of its schema.
 * Stored values that do not fit the schema fall back to the default, so
 * plugins never see a value of the wrong type.
 */
export function resolveSettings(
  manifest: PluginManifest,
  stored: Readonly<Record<string, unknown>> | undefined,
): PluginSettingValues {
  const values: PluginSettingValues = {};
  for (const [key, field] of Object.entries(manifest.settings ?? {})) {
    const value = stored?.[key];
    values[key] = fits(field, value) ? value : field.default;
  }
  return values;
}

function fits(field: SettingField, value: unknown): value is SettingValue {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean";
    case "string":
    case "text":
      return typeof value === "string";
    case "range":
      return isFiniteNumber(value) && value >= field.min && value <= field.max;
    case "number":
      return (
        isFiniteNumber(value) &&
        (field.min === undefined || value >= field.min) &&
        (field.max === undefined || value <= field.max)
      );
    case "select":
      return field.options.some((option) => option.value === value);
    case "color":
      return typeof value === "string" && COLOR_PATTERN.test(value);
    case "shortcut":
      return isShortcutValue(value);
  }
}

/**
 * Builds the API object for one plugin. `getSettings` returns the plugin's
 * current effective settings. `dispose` removes everything the plugin
 * injected through the API.
 */
export function createApi(
  manifest: PluginManifest,
  services: Services,
  getSettings: () => PluginSettingValues,
): { api: PluginApi; dispose: () => void } {
  const cleanups = new Set<() => void>();
  const require = (permission: Permission): void => {
    if (!manifest.permissions.includes(permission)) {
      throw new PermissionError(manifest.name, permission);
    }
  };

  /** Remembers how to undo something, so that unloading the plugin undoes it. */
  const tracked = (remove: () => void): (() => void) => {
    const cleanup = (): void => {
      if (cleanups.delete(cleanup)) remove();
    };
    cleanups.add(cleanup);
    return cleanup;
  };

  const ui: UiApi = {
    injectCss: (css) => tracked(services.ui.injectCss(css)),
    waitForElement: (selector) => services.ui.waitForElement(selector),
    showNotice: (text, action) => services.ui.showNotice(text, action),
    addNavButton: (label, onClick) => tracked(services.ui.addNavButton(label, onClick)),
    addShortcut: (shortcut, onPress) => tracked(services.ui.addShortcut(shortcut, onPress)),
    navigate: (target) => services.ui.navigate(target),
    addPanel(title) {
      const panel = services.ui.addPanel(title);
      const remove = tracked(() => panel.remove());
      return {
        ...panel,
        // A spread would freeze the getter at its current value.
        get open() {
          return panel.open;
        },
        remove,
      };
    },
  };

  let resetsOutputDelay = false;
  const audio: AudioApi = {
    addEffect: (order, build) => tracked(services.audio.addEffect(order, build)),
    getOutputDevice: () => services.audio.getOutputDevice(),
    onOutputDeviceChange: (handler) => tracked(services.audio.onOutputDeviceChange(handler)),
    setOutputDelay(seconds) {
      if (!resetsOutputDelay) {
        resetsOutputDelay = true;
        tracked(() => services.audio.setOutputDelay(0));
      }
      services.audio.setOutputDelay(seconds);
    },
  };

  /** The address in a fixed form, if the plugin may contact it. Throws otherwise. */
  const allowedUrl = (url: string): string => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`invalid URL: ${url}`);
    }
    if (parsed.protocol !== "https:" || !manifest.hosts?.includes(parsed.hostname)) {
      throw new Error(`plugin "${manifest.name}" may not contact ${parsed.origin}`);
    }
    return parsed.href;
  };
  const net: NetApi = {
    // `async`, so that a refused address rejects instead of throwing.
    getJson: async (url) => services.net.getJson(allowedUrl(url)),
    request: async (url, request) => services.net.request(allowedUrl(url), checkRequest(request)),
  };

  const settings: SettingsApi = {
    get: (key) => getSettings()[key],
    getAll: () => ({ ...getSettings() }),
    update(values) {
      for (const [key, value] of Object.entries(values)) {
        const field = manifest.settings?.[key];
        if (!field || !fits(field, value)) {
          const reason = `plugin "${manifest.name}": invalid value for setting "${key}"`;
          return Promise.reject(new Error(reason));
        }
      }
      return services.saveSettings(manifest.name, { ...values });
    },
  };

  const api: PluginApi = {
    get music() {
      require("music.read");
      return services.music;
    },
    get player() {
      require("music.control");
      return services.player;
    },
    get audio() {
      require("audio");
      return audio;
    },
    get ui() {
      require("ui.inject");
      return ui;
    },
    get net() {
      require("network");
      return net;
    },
    get notify() {
      require("notify");
      return services.notify;
    },
    settings,
  };

  return {
    api,
    dispose() {
      for (const cleanup of [...cleanups]) cleanup();
    },
  };
}

import type { PluginSettingValues } from "../../shared/types";
import { t } from "../../core/i18n";

/** Centre frequencies of the ten bands, in hertz. */
export const FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

/** The setting that holds a band's gain when the Custom preset is selected. */
export const bandKey = (frequency: number): string => `band${frequency}`;

export const MAX_GAIN_DB = 12;

/** Gains in decibels, one per band, lowest frequency first. */
export const PRESETS: Readonly<Record<string, readonly number[]>> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 2, 4, 6, 7],
  vocal: [-3, -2, -1, 1, 3, 4, 4, 3, 1, 0],
  rock: [5, 4, 2, 0, -1, -1, 1, 3, 4, 5],
  pop: [-1, 0, 2, 3, 4, 3, 2, 0, -1, -1],
  electronic: [5, 4, 2, 0, -2, 1, 1, 2, 4, 5],
  classical: [4, 3, 2, 1, 0, 0, 0, 1, 2, 3],
  loudness: [6, 4, 1, 0, -1, -1, 0, 1, 4, 6],
};

/** A preset the user saved under a name of their own. */
export interface UserPreset {
  name: string;
  gains: number[];
}

/** The `preset` setting of a saved preset is this prefix plus its name. */
export const USER_PREFIX = "user:";
export const MAX_USER_PRESETS = 20;
export const MAX_PRESET_NAME_LENGTH = 30;

const clamp = (value: number): number => Math.min(MAX_GAIN_DB, Math.max(-MAX_GAIN_DB, value));
const cleanGain = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value) : 0;

/**
 * Reads the saved presets from their setting, a JSON text. Anything that is
 * not a well-formed preset is dropped, so a damaged setting cannot break the
 * equalizer.
 */
export function parseUserPresets(setting: unknown): UserPreset[] {
  let parsed: unknown;
  try {
    parsed = typeof setting === "string" ? JSON.parse(setting) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const presets: UserPreset[] = [];
  for (const entry of parsed as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { name, gains } = entry as Record<string, unknown>;
    const valid =
      typeof name === "string" &&
      name !== "" &&
      name.length <= MAX_PRESET_NAME_LENGTH &&
      Array.isArray(gains) &&
      gains.length === FREQUENCIES.length &&
      !presets.some((preset) => preset.name === name);
    if (valid && presets.length < MAX_USER_PRESETS) {
      presets.push({ name, gains: (gains as unknown[]).map(cleanGain) });
    }
  }
  return presets;
}

/**
 * Adds a preset, or replaces the one with the same name. Throws with a
 * message for the user if the name is unusable or the list is full.
 */
export function withUserPreset(presets: readonly UserPreset[], name: string, gains: readonly number[]): UserPreset[] {
  const trimmed = name.trim();
  if (trimmed === "") throw new Error(t("Enter a name."));
  if (trimmed.length > MAX_PRESET_NAME_LENGTH) {
    throw new Error(t("Use at most {count} characters.", { count: MAX_PRESET_NAME_LENGTH }));
  }
  const preset = { name: trimmed, gains: FREQUENCIES.map((_, index) => cleanGain(gains[index])) };
  if (presets.some((existing) => existing.name === trimmed)) {
    return presets.map((existing) => (existing.name === trimmed ? preset : existing));
  }
  if (presets.length >= MAX_USER_PRESETS) {
    throw new Error(t("Delete a preset first: {count} is the limit.", { count: MAX_USER_PRESETS }));
  }
  return [...presets, preset];
}

/**
 * The gain of every band for the given settings: a built-in preset, a saved
 * one, or the custom sliders. A preset that no longer exists counts as custom.
 */
export function gainsFor(settings: PluginSettingValues): number[] {
  const selected = String(settings.preset);
  const builtin = PRESETS[selected];
  if (builtin) return [...builtin];
  if (selected.startsWith(USER_PREFIX)) {
    const name = selected.slice(USER_PREFIX.length);
    const saved = parseUserPresets(settings.presets).find((preset) => preset.name === name);
    if (saved) return [...saved.gains];
  }
  return FREQUENCIES.map((frequency) => cleanGain(settings[bandKey(frequency)]));
}

/** A preset as the flat settings of a file to share: one value per band and the pre-amplifier. */
export function presetFileSettings(gains: readonly number[], preampDb: number): PluginSettingValues {
  const values: PluginSettingValues = { preamp: cleanGain(preampDb) };
  for (const [index, frequency] of FREQUENCIES.entries()) values[bandKey(frequency)] = cleanGain(gains[index]);
  return values;
}

/**
 * Reads a preset from the settings of a shared file. Missing or invalid bands
 * count as 0 dB and everything is kept within the sliders' range. `null` if
 * the file names no band at all: it is not an equalizer preset then.
 */
export function presetFromFile(settings: Record<string, unknown>): { gains: number[]; preamp: number } | null {
  const isBand = (frequency: number): boolean => typeof settings[bandKey(frequency)] === "number";
  if (!FREQUENCIES.some(isBand)) return null;
  return {
    gains: FREQUENCIES.map((frequency) => cleanGain(settings[bandKey(frequency)])),
    preamp: cleanGain(settings.preamp),
  };
}

/** Converts decibels to the linear factor a GainNode expects. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

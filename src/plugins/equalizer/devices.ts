// Which preset was last chosen with which output device. For the own curve
// ("custom") the bands are kept too, since the name alone does not say what
// they were.

/** Only this many devices are remembered; the ones used longest ago go first. */
export const MAX_DEVICES = 30;
const MAX_NAME_LENGTH = 120;
const MAX_PRESET_LENGTH = 40;
const BANDS = 10;
const MAX_GAIN_DB = 12;

/** What a device brings back: a preset, and for the own curve its bands. */
export interface DeviceChoice {
  preset: string;
  /** Only with `preset` "custom": the gain of each band in dB. */
  bands?: number[];
}

const validPreset = (preset: unknown): preset is string =>
  typeof preset === "string" && preset !== "" && preset.length <= MAX_PRESET_LENGTH;

const validBands = (bands: unknown): bands is number[] =>
  Array.isArray(bands) &&
  bands.length === BANDS &&
  bands.every((gain) => typeof gain === "number" && Number.isFinite(gain) && Math.abs(gain) <= MAX_GAIN_DB);

function readChoice(value: unknown): DeviceChoice | null {
  // Before the bands were kept, a choice was the preset's name only.
  if (validPreset(value)) return { preset: value };
  if (typeof value !== "object" || value === null) return null;
  const { preset, bands } = value as Record<string, unknown>;
  if (preset !== "custom" || !validBands(bands)) return null;
  return { preset, bands: [...bands] };
}

/** Reads the stored choices, a JSON object by device name. Anything else in the text is dropped. */
export function parseDevicePresets(setting: unknown): Map<string, DeviceChoice> {
  const choices = new Map<string, DeviceChoice>();
  let parsed: unknown;
  try {
    parsed = typeof setting === "string" && setting !== "" ? JSON.parse(setting) : {};
  } catch {
    return choices;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return choices;
  for (const [device, value] of Object.entries(parsed)) {
    const choice = device !== "" && device.length <= MAX_NAME_LENGTH ? readChoice(value) : null;
    if (choice) choices.set(device, choice);
  }
  return choices;
}

/** Whether two choices bring back the same sound. */
export function sameChoice(a: DeviceChoice | undefined, b: DeviceChoice | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The stored text after choosing `choice` with `device`. */
export function withDevicePreset(
  choices: ReadonlyMap<string, DeviceChoice>,
  device: string,
  choice: DeviceChoice | string,
): string {
  const next = new Map(choices);
  // Insertion order is age: the device just used goes to the end.
  next.delete(device);
  next.set(device, typeof choice === "string" ? { preset: choice } : choice);
  const stored = [...next]
    .slice(-MAX_DEVICES)
    .map(([name, { preset, bands }]) => [name, bands ? { preset, bands } : preset] as const);
  return JSON.stringify(Object.fromEntries(stored));
}

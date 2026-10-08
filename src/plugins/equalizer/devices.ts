// Which preset was last chosen with which output device.

/** Only this many devices are remembered; the ones used longest ago go first. */
export const MAX_DEVICES = 30;
const MAX_NAME_LENGTH = 120;
const MAX_PRESET_LENGTH = 40;

/** Reads the stored choices, a JSON object of preset names by device name. Anything else in the text is dropped. */
export function parseDevicePresets(setting: unknown): Map<string, string> {
  const choices = new Map<string, string>();
  let parsed: unknown;
  try {
    parsed = typeof setting === "string" && setting !== "" ? JSON.parse(setting) : {};
  } catch {
    return choices;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return choices;
  for (const [device, preset] of Object.entries(parsed)) {
    const valid =
      device !== "" &&
      device.length <= MAX_NAME_LENGTH &&
      typeof preset === "string" &&
      preset !== "" &&
      preset.length <= MAX_PRESET_LENGTH;
    if (valid) choices.set(device, preset as string);
  }
  return choices;
}

/** The stored text after choosing `preset` with `device`. */
export function withDevicePreset(choices: ReadonlyMap<string, string>, device: string, preset: string): string {
  // Insertion order is age: the device just used goes to the end.
  const next = new Map(choices);
  next.delete(device);
  next.set(device, preset);
  return JSON.stringify(Object.fromEntries([...next].slice(-MAX_DEVICES)));
}

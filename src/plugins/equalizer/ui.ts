// The equalizer's panel: presets, response graph, one slider per band, pre-amplifier.
import type { PluginSettingValues, SharedFile } from "../../shared/types";
import {
  FREQUENCIES,
  MAX_GAIN_DB,
  MAX_PRESET_NAME_LENGTH,
  PRESETS,
  USER_PREFIX,
  bandKey,
  gainsFor,
  parseUserPresets,
  presetFromFile,
  withUserPreset,
  type UserPreset,
} from "./bands";
import { parseAutoEq } from "./autoeq";
import { GRAPH, curvePath, graphFrequencies, xFor, yFor } from "./curve";
import { responseDb } from "./filters";
import { t } from "../../core/i18n";

export const UI_CLASS = "ytmd-eq";

export const UI_CSS = `
.${UI_CLASS} { padding: 16px; overflow-y: auto; }
.${UI_CLASS} select, .${UI_CLASS} button, .${UI_CLASS} input[type="text"] {
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  background: #1c1c1c;
  color: #fff;
  font: inherit;
}
.${UI_CLASS} button { flex-shrink: 0; cursor: pointer; }
.${UI_CLASS} button:disabled { opacity: 0.4; cursor: default; }
.${UI_CLASS}-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.${UI_CLASS}-row select, .${UI_CLASS}-row input[type="text"] { flex: 1; }
.${UI_CLASS}-save { margin-top: 8px; }
.${UI_CLASS}-message { min-height: 16px; margin: 6px 0 0; color: #ffb4ab; font-size: 12px; }
.${UI_CLASS} svg {
  display: block;
  width: 100%;
  margin: 8px 0 16px;
  border-radius: 8px;
  background: #151515;
}
.${UI_CLASS}-grid { stroke: rgba(255, 255, 255, 0.12); stroke-width: 1; }
.${UI_CLASS}-curve { fill: none; stroke: #ff4e45; stroke-width: 2; }
.${UI_CLASS}-bands { display: flex; justify-content: space-between; }
.${UI_CLASS}-band { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 30px; }
.${UI_CLASS}-band input {
  width: 20px;
  height: 130px;
  writing-mode: vertical-lr;
  direction: rtl;
  accent-color: #ff4e45;
}
.${UI_CLASS} small { color: rgba(255, 255, 255, 0.6); font-size: 11px; white-space: nowrap; }
.${UI_CLASS} output { font-size: 11px; font-variant-numeric: tabular-nums; }
.${UI_CLASS}-preamp { margin-top: 16px; }
.${UI_CLASS}-preamp input { flex: 1; accent-color: #ff4e45; }
.${UI_CLASS}-files { margin-top: 20px; padding-top: 12px; border-top: 1px solid rgba(255, 255, 255, 0.12); }
.${UI_CLASS}-files h3 { margin: 0 0 8px; font-size: 12px; font-weight: 500; color: rgba(255, 255, 255, 0.6); }
.${UI_CLASS}-files ul { margin: 0 0 8px; padding: 0; list-style: none; }
.${UI_CLASS}-files li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; }
.${UI_CLASS}-files li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${UI_CLASS}-files .${UI_CLASS}-row { justify-content: flex-start; flex-wrap: wrap; }
.${UI_CLASS}-note { margin: 6px 0 0; color: rgba(255, 255, 255, 0.6); font-size: 12px; }
`;

const SVG = "http://www.w3.org/2000/svg";
const POINTS = 96;
export const BUILTIN_LABELS: Readonly<Record<string, string>> = {
  flat: "Flat",
  bass: "Bass boost",
  treble: "Treble boost",
  vocal: "Vocal",
  rock: "Rock",
  pop: "Pop",
  electronic: "Electronic",
  classical: "Classical",
  loudness: "Loudness",
};
const CUSTOM = "custom";

const frequencyLabel = (hz: number): string => (hz >= 1000 ? `${hz / 1000}k` : String(hz));
const signed = (db: number): string => (db > 0 ? `+${db}` : String(db));

export interface EqualizerUi {
  /** Shows the given settings. */
  render(settings: PluginSettingValues): void;
  /** Shows the preset files in the user's folder. */
  setFiles(files: readonly SharedFile[]): void;
  /** Says how saving or reading a file went. */
  setFileMessage(text: string): void;
  /** Shows which device the sound goes to, or nothing for `null`. */
  setDevice(name: string | null): void;
}

interface Handlers {
  /** The user is dragging a slider: apply to the sound, but do not save yet. */
  onPreview(gains: readonly number[], preampDb: number): void;
  /** The user settled on a change: save these settings. */
  onCommit(values: PluginSettingValues): void;
  /** Write the sliders as shown to a file of this name. */
  onExport(name: string, gains: readonly number[], preampDb: number): void;
  /** Read the folder again. */
  onRefresh(): void;
  onOpenFolder(): void;
}

/** Builds the panel's content inside `container`. */
export function createEqualizerUi(container: HTMLElement, handlers: Handlers): EqualizerUi {
  const doc = container.ownerDocument;
  // Trusted Types forbid innerHTML here: build everything by hand.
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = ""): HTMLElementTagNameMap[K] => {
    const created = doc.createElement(tag);
    if (className) created.className = className;
    return created;
  };
  const button = (parent: HTMLElement, label: string): HTMLButtonElement => {
    const created = parent.appendChild(element("button"));
    created.type = "button";
    created.textContent = label;
    return created;
  };

  let gains: number[] = [...(PRESETS.flat ?? [])];
  let preamp = 0;
  let saved: UserPreset[] = [];

  /** The band values as settings, so that the sound stays when the preset becomes "custom". */
  const customValues = (): PluginSettingValues => {
    const values: PluginSettingValues = { preset: CUSTOM };
    for (const [index, hz] of FREQUENCIES.entries()) values[bandKey(hz)] = gains[index] ?? 0;
    return values;
  };

  const root = container.appendChild(element("div", UI_CLASS));

  // Preset row.
  const top = root.appendChild(element("div", `${UI_CLASS}-row`));
  const preset = top.appendChild(element("select"));
  preset.setAttribute("aria-label", t("Preset"));
  const remove = button(top, t("Delete"));
  const reset = button(top, t("Reset"));

  // Saving the current sliders under a name.
  const saveRow = root.appendChild(element("div", `${UI_CLASS}-row ${UI_CLASS}-save`));
  const name = saveRow.appendChild(element("input"));
  name.type = "text";
  name.maxLength = MAX_PRESET_NAME_LENGTH;
  name.placeholder = t("Name for a new preset");
  name.setAttribute("aria-label", t("Preset name"));
  const save = button(saveRow, t("Save"));
  const exportFile = button(saveRow, t("Save as file"));
  const message = root.appendChild(element("p", `${UI_CLASS}-message`));
  message.setAttribute("role", "alert");

  function fillPresets(selected: string): void {
    const option = (parent: HTMLElement, value: string, label: string): void => {
      const created = parent.appendChild(element("option"));
      created.value = value;
      created.textContent = label;
    };
    preset.replaceChildren();
    for (const [value, label] of Object.entries(BUILTIN_LABELS)) option(preset, value, t(label));
    if (saved.length > 0) {
      const group = preset.appendChild(element("optgroup"));
      group.label = t("Saved");
      for (const userPreset of saved) option(group, USER_PREFIX + userPreset.name, userPreset.name);
    }
    option(preset, CUSTOM, t("Custom"));
    // A saved preset that no longer exists plays the custom sliders.
    preset.value = [...preset.options].some((o) => o.value === selected) ? selected : CUSTOM;
    remove.disabled = !preset.value.startsWith(USER_PREFIX);
  }

  // Response graph.
  const svg = root.appendChild(doc.createElementNS(SVG, "svg"));
  svg.setAttribute("viewBox", `0 0 ${GRAPH.width} ${GRAPH.height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("Frequency response"));
  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    const grid = svg.appendChild(doc.createElementNS(SVG, "line"));
    grid.setAttribute("class", `${UI_CLASS}-grid`);
    for (const [key, value] of Object.entries({ x1, y1, x2, y2 })) grid.setAttribute(key, String(value));
  };
  for (const db of [-12, 0, 12]) line(0, yFor(db), GRAPH.width, yFor(db));
  for (const hz of [100, 1000, 10000]) line(xFor(hz), 0, xFor(hz), GRAPH.height);
  const curve = svg.appendChild(doc.createElementNS(SVG, "path"));
  curve.setAttribute("class", `${UI_CLASS}-curve`);
  const graphHz = graphFrequencies(POINTS);

  // Band sliders.
  const bands = root.appendChild(element("div", `${UI_CLASS}-bands`));
  const sliders = FREQUENCIES.map((frequency, index) => {
    const band = bands.appendChild(element("label", `${UI_CLASS}-band`));
    const value = band.appendChild(element("output"));
    const slider = band.appendChild(element("input"));
    slider.type = "range";
    slider.min = String(-MAX_GAIN_DB);
    slider.max = String(MAX_GAIN_DB);
    slider.step = "1";
    slider.setAttribute("aria-label", `${frequency} Hz`);
    band.appendChild(element("small")).textContent = frequencyLabel(frequency);

    slider.addEventListener("input", () => {
      gains[index] = slider.valueAsNumber;
      preset.value = CUSTOM;
      remove.disabled = true;
      draw();
      handlers.onPreview(gains, preamp);
    });
    // Editing a band turns whatever was shown into the custom setting.
    slider.addEventListener("change", () => handlers.onCommit(customValues()));
    return { slider, value };
  });

  // Pre-amplifier.
  const preampRow = root.appendChild(element("label", `${UI_CLASS}-row ${UI_CLASS}-preamp`));
  preampRow.appendChild(element("small")).textContent = t("Pre-amp");
  const preampSlider = preampRow.appendChild(element("input"));
  preampSlider.type = "range";
  preampSlider.min = String(-MAX_GAIN_DB);
  preampSlider.max = String(MAX_GAIN_DB);
  preampSlider.step = "1";
  const preampValue = preampRow.appendChild(element("output"));
  preampSlider.addEventListener("input", () => {
    preamp = preampSlider.valueAsNumber;
    draw();
    handlers.onPreview(gains, preamp);
  });
  preampSlider.addEventListener("change", () => handlers.onCommit({ preamp }));

  preset.addEventListener("change", () => handlers.onCommit({ preset: preset.value }));
  reset.addEventListener("click", () => handlers.onCommit({ preset: "flat", preamp: 0 }));

  const saveCurrent = (): void => {
    try {
      const presets = withUserPreset(saved, name.value, gains);
      message.textContent = "";
      handlers.onCommit({
        presets: JSON.stringify(presets),
        preset: USER_PREFIX + name.value.trim(),
      });
      name.value = "";
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  save.addEventListener("click", saveCurrent);
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveCurrent();
  });
  // Keeps YouTube Music's keyboard shortcuts from firing while typing a name.
  for (const type of ["keydown", "keyup", "keypress"]) {
    name.addEventListener(type, (event) => event.stopPropagation());
  }

  // The name typed in, or else that of the saved preset being shown.
  exportFile.addEventListener("click", () => {
    const selected = preset.value.startsWith(USER_PREFIX) ? preset.value.slice(USER_PREFIX.length) : "";
    handlers.onExport(name.value.trim() || selected, gains, preamp);
  });

  // Preset files: what is in the folder, and the way into it.
  const files = root.appendChild(element("div", `${UI_CLASS}-files`));
  files.appendChild(element("h3")).textContent = t("Preset files");
  const fileList = files.appendChild(element("ul"));
  const fileRow = files.appendChild(element("div", `${UI_CLASS}-row`));
  button(fileRow, t("Open folder")).addEventListener("click", () => handlers.onOpenFolder());
  button(fileRow, t("Refresh")).addEventListener("click", () => handlers.onRefresh());
  // Settings for a pair of headphones from the AutoEq project, as a text file.
  const picker = fileRow.appendChild(element("input"));
  picker.type = "file";
  picker.accept = ".txt,text/plain";
  picker.hidden = true;
  button(fileRow, t("Import AutoEq file")).addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    const chosen = picker.files?.[0];
    // Emptied, so that choosing the same file again counts as a change.
    picker.value = "";
    if (!chosen) return;
    if (chosen.size > 256 * 1024) {
      fileMessage.textContent = t('"{name}" is too large to be an AutoEq file.', { name: chosen.name });
      return;
    }
    chosen.text().then(
      (text) => importAutoEq(chosen.name, text),
      () => (fileMessage.textContent = t('Could not read "{name}".', { name: chosen.name })),
    );
  });
  const deviceLine = files.appendChild(element("p", `${UI_CLASS}-note`));
  const fileMessage = files.appendChild(element("p", `${UI_CLASS}-note`));
  fileMessage.setAttribute("role", "status");

  /** Takes a file's preset into the saved presets and switches to it. */
  const importFile = (file: SharedFile): void => {
    const read = presetFromFile(file.settings);
    if (!read) {
      fileMessage.textContent = t('"{name}" is not an equalizer preset.', { name: file.name });
      return;
    }
    try {
      const presetName = file.name.trim().slice(0, MAX_PRESET_NAME_LENGTH).trim();
      const presets = withUserPreset(saved, presetName, read.gains);
      handlers.onCommit({
        presets: JSON.stringify(presets),
        preset: USER_PREFIX + presetName,
        preamp: read.preamp,
      });
      fileMessage.textContent = t('Imported "{name}".', { name: presetName });
    } catch (error) {
      fileMessage.textContent = error instanceof Error ? error.message : String(error);
    }
  };

  /** Takes the settings from an AutoEq file into the saved presets and switches to them. */
  function importAutoEq(fileName: string, text: string): void {
    const read = parseAutoEq(text);
    if (!read) {
      fileMessage.textContent = t('"{name}" holds no AutoEq settings.', { name: fileName });
      return;
    }
    try {
      // AutoEq names its files after the headphones: "Sony WH-1000XM4 FixedBandEQ.txt".
      const presetName = fileName
        .replace(/\.[^.]*$/, "")
        .replace(/\s*(FixedBandEQ|ParametricEQ|GraphicEQ)$/i, "")
        .trim()
        .slice(0, MAX_PRESET_NAME_LENGTH)
        .trim();
      const presets = withUserPreset(saved, presetName, read.gains);
      handlers.onCommit({ presets: JSON.stringify(presets), preset: USER_PREFIX + presetName, preamp: read.preamp });
      fileMessage.textContent = t('Imported "{name}".', { name: presetName });
    } catch (error) {
      fileMessage.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  remove.addEventListener("click", () => {
    const selected = preset.value.slice(USER_PREFIX.length);
    const presets = saved.filter((userPreset) => userPreset.name !== selected);
    // The sliders keep the deleted preset's values, now as the custom setting.
    handlers.onCommit({ ...customValues(), presets: JSON.stringify(presets) });
  });

  function draw(): void {
    for (const [index, { slider, value }] of sliders.entries()) {
      const gain = gains[index] ?? 0;
      slider.value = String(gain);
      value.textContent = signed(gain);
    }
    preampSlider.value = String(preamp);
    preampValue.textContent = `${signed(preamp)} dB`;
    curve.setAttribute("d", curvePath(graphHz, responseDb(gains, preamp, graphHz)));
  }

  return {
    render(settings) {
      gains = gainsFor(settings);
      preamp = typeof settings.preamp === "number" ? settings.preamp : 0;
      saved = parseUserPresets(settings.presets);
      fillPresets(String(settings.preset));
      draw();
    },
    setFiles(found) {
      fileList.replaceChildren();
      for (const file of found) {
        const item = fileList.appendChild(element("li"));
        item.appendChild(element("span")).textContent = file.name;
        button(item, t("Import")).addEventListener("click", () => importFile(file));
      }
      if (found.length === 0) {
        fileList.appendChild(element("li")).appendChild(element("small")).textContent =
          t("No files yet. Save one, or put a file someone sent you into the folder.");
      }
    },
    setFileMessage(text) {
      fileMessage.textContent = text;
    },
    setDevice(name) {
      deviceLine.textContent = name === null ? "" : t("Output device: {name}", { name });
    },
  };
}

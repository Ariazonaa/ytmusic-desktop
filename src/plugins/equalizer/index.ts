// Equalizer: ten bands with presets and a pre-amplifier, adjusted in a panel
// that shows the resulting frequency response.
import { parseManifest } from "../../core/plugin-manager/api";
import { listShared, openSharedFolder, saveShared } from "../../core/settings/client";
import type { Panel, Plugin, PluginApi } from "../../shared/types";
import { dbToGain, gainsFor, presetFileSettings } from "./bands";
import { parseDevicePresets, withDevicePreset } from "./devices";
import { createFilters } from "./filters";
import manifest from "./plugin.json";
import { UI_CSS, createEqualizerUi, type EqualizerUi } from "./ui";
import { t } from "../../core/i18n";

/** Position in the audio chain: before the compressor. */
const ORDER = 10;
/** Seconds over which a changed gain is faded in, to avoid clicks. */
const FADE = 0.05;

let api: PluginApi | undefined;
let context: AudioContext | undefined;
let preamp: GainNode | undefined;
let filters: BiquadFilterNode[] = [];
let panel: Panel | undefined;
let ui: EqualizerUi | undefined;
/** The device the sound goes to, if the plugin was asked to remember presets per device. */
let device: string | null = null;

/** Sets the filters. Does nothing until the audio chain has been built. */
function applyGains(gains: readonly number[], preampDb: number): void {
  if (!context || !preamp) return;
  const now = context.currentTime;
  for (const [index, gain] of gains.entries()) {
    filters[index]?.gain.setTargetAtTime(gain, now, FADE);
  }
  preamp.gain.setTargetAtTime(dbToGain(preampDb), now, FADE);
}

function applySettings(): void {
  if (!api) return;
  const settings = api.settings.getAll();
  applyGains(gainsFor(settings), typeof settings.preamp === "number" ? settings.preamp : 0);
  ui?.render(settings);
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const save = (values: Record<string, string>): void => {
  api?.settings.update(values).catch((error: unknown) => {
    console.warn("[equalizer] could not save settings", error);
  });
};

/** The sound goes to `name` now: bring back the preset last chosen with that device. */
function deviceChanged(name: string | null): void {
  device = name;
  if (!api) return;
  const settings = api.settings.getAll();
  const perDevice = settings.perDevice === true;
  ui?.setDevice(perDevice ? name : null);
  if (!perDevice || name === null) return;
  const remembered = parseDevicePresets(settings.devicePresets).get(name);
  if (remembered !== undefined && remembered !== settings.preset) save({ preset: remembered });
}

/** Notes the chosen preset for the device in use, so that it comes back with it. */
function rememberForDevice(): void {
  if (!api) return;
  const settings = api.settings.getAll();
  const perDevice = settings.perDevice === true;
  ui?.setDevice(perDevice ? device : null);
  if (!perDevice || device === null || typeof settings.preset !== "string") return;
  const choices = parseDevicePresets(settings.devicePresets);
  if (choices.get(device) !== settings.preset) save({ devicePresets: withDevicePreset(choices, device, settings.preset) });
}

async function refreshFiles(): Promise<void> {
  try {
    ui?.setFiles(await listShared("equalizer"));
  } catch (error) {
    ui?.setFileMessage(t("Could not read the folder: {reason}", { reason: describe(error) }));
  }
}

async function exportPreset(name: string, gains: readonly number[], preampDb: number): Promise<void> {
  try {
    await saveShared("equalizer", name, presetFileSettings(gains, preampDb));
    ui?.setFileMessage(t('Saved "{name}" as a file.', { name }));
    await refreshFiles();
  } catch (error) {
    ui?.setFileMessage(t("Could not save the file: {reason}", { reason: describe(error) }));
  }
}

const equalizer: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.audio.addEffect(ORDER, (audioContext) => {
      context = audioContext;
      preamp = audioContext.createGain();
      filters = createFilters(audioContext);
      let tail: AudioNode = preamp;
      for (const filter of filters) {
        tail.connect(filter);
        tail = filter;
      }
      applySettings();
      return { input: preamp, output: tail };
    });
    api.ui.injectCss(UI_CSS);
    api.ui.addNavButton(t("Equalizer"), () => {
      if (panel?.open) {
        panel.hide();
      } else {
        panel?.show();
        void refreshFiles();
      }
    });
  },

  onUIReady() {
    if (!api) return;
    const settings = api.settings;
    panel = api.ui.addPanel(t("Equalizer"));
    ui = createEqualizerUi(panel.body, {
      onPreview: applyGains,
      onCommit: (values) => {
        settings.update(values).catch((error: unknown) => {
          console.warn("[equalizer] could not save settings", error);
        });
      },
      onExport: (name, gains, preampDb) => void exportPreset(name, gains, preampDb),
      onRefresh: () => void refreshFiles(),
      onOpenFolder: () => {
        openSharedFolder("equalizer").catch((error: unknown) => ui?.setFileMessage(describe(error)));
      },
    });
    ui.render(settings.getAll());
    void refreshFiles();
    // The preset for the device in use applies from the start.
    const audio = api.audio;
    audio.onOutputDeviceChange(deviceChanged);
    audio.getOutputDevice().then(deviceChanged, () => {});
  },

  onSettingsChange() {
    applySettings();
    rememberForDevice();
  },

  onUnload() {
    // The API removes the effect, the button, the panel and the CSS.
    api = context = preamp = panel = ui = undefined;
    device = null;
    filters = [];
  },
};

export default equalizer;

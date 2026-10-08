// Track info: codec, bitrate, sample rate and loudness of the playing track,
// in a panel. The player calls these its "stats for nerds".
import { parseManifest } from "../../core/plugin-manager/api";
import { findPlayer } from "../../core/player/playback";
import type { Panel, Plugin, PluginApi } from "../../shared/types";
import { describeTrack, type AudioFormat, type PlayerStats } from "./info";
import manifest from "./plugin.json";
import { t } from "../../core/i18n";

const CLASS = "ytmd-track-info";
/** Values of rows that are words rather than figures. */
export const VALUE_WORDS = ["Stereo", "Mono", "Low", "Normal", "High"];
const REFRESH_MS = 1000;

const CSS = `
.${CLASS} { margin: 0; padding: 16px; display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: 13px; }
.${CLASS} dt { color: rgba(255, 255, 255, 0.6); }
.${CLASS} dd { margin: 0; font-variant-numeric: tabular-nums; word-break: break-all; }
.${CLASS}-empty { padding: 16px; color: rgba(255, 255, 255, 0.6); }
`;

type StatsPlayer = Element & {
  getStatsForNerds?: () => PlayerStats | undefined;
  getPlayerResponse?: () => { streamingData?: { adaptiveFormats?: AudioFormat[] } } | undefined;
};

let api: PluginApi | undefined;
let panel: Panel | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

function render(): void {
  if (!api || !panel?.open) return;
  const player = findPlayer(document) as StatsPlayer | null;
  const rows = describeTrack({
    videoId: api.music.getVideoId(),
    stats: player?.getStatsForNerds?.() ?? null,
    formats: player?.getPlayerResponse?.()?.streamingData?.adaptiveFormats ?? [],
    loudnessLkfs: api.music.getLoudnessLkfs(),
  });
  // Trusted Types forbid innerHTML here: build everything by hand.
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = `${CLASS}-empty`;
    empty.textContent = t("Nothing is playing.");
    panel.body.replaceChildren(empty);
    return;
  }
  const list = document.createElement("dl");
  list.className = CLASS;
  for (const { label, value } of rows) {
    list.appendChild(document.createElement("dt")).textContent = t(label);
    // Values are numbers and names, except these few words.
    list.appendChild(document.createElement("dd")).textContent = VALUE_WORDS.includes(value) ? t(value) : value;
  }
  panel.body.replaceChildren(list);
}

const trackInfo: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.ui.injectCss(CSS);
    api.ui.addNavButton(t("Info"), () => {
      if (panel?.open) {
        panel.hide();
      } else {
        panel?.show();
        render();
      }
    });
  },

  onUIReady() {
    panel = api?.ui.addPanel(t("Track info"));
    // Buffer and connection change all the time; a hidden panel is not redrawn.
    timer = setInterval(render, REFRESH_MS);
  },

  onUnload() {
    clearInterval(timer);
    api = panel = undefined;
  },
};

export default trackInfo;

// Stats: the most heard tracks and artists and the listening time per day,
// kept on this computer only.
import { parseManifest } from "../../core/plugin-manager/api";
import { statsClear, statsRecord, statsSummary, type StatsSummary } from "../../core/settings/client";
import { t } from "../../core/i18n";
import type { Panel, Plugin, PluginApi, Song } from "../../shared/types";
import { Listening, lastDays, type Heard } from "./listening";
import manifest from "./plugin.json";

const CLASS = "ytmd-stats";
const DAYS = 30;

const CSS = `
.${CLASS} { padding: 16px; display: flex; flex-direction: column; gap: 16px; font-size: 13px; }
.${CLASS} h3 { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: rgba(255, 255, 255, 0.7); text-transform: uppercase; letter-spacing: 0.04em; }
.${CLASS} ol { margin: 0; padding-left: 22px; }
.${CLASS} li { margin-bottom: 4px; }
.${CLASS} li small { color: rgba(255, 255, 255, 0.6); }
.${CLASS}-days { display: flex; align-items: flex-end; gap: 2px; height: 80px; }
.${CLASS}-days div { flex: 1; min-height: 1px; background: #e53935; border-radius: 2px 2px 0 0; }
.${CLASS}-total, .${CLASS}-empty { color: rgba(255, 255, 255, 0.7); margin: 0; }
.${CLASS}-row { display: flex; gap: 8px; }
.${CLASS}-row button { padding: 6px 10px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: #1c1c1c; color: #fff; font: inherit; cursor: pointer; }
`;

let api: PluginApi | undefined;
let panel: Panel | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
const listening = new Listening();
let clearing = false;

const minutes = (seconds: number): string => t("{minutes} min", { minutes: Math.round(seconds / 60) });

function record(heard: Heard | null): void {
  if (!heard) return;
  statsRecord(heard).catch((error: unknown) => console.warn("[stats] could not record", error));
}

function element<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const created = parent.appendChild(document.createElement(tag));
  if (text !== undefined) created.textContent = text;
  return created;
}

function render(summary: StatsSummary): void {
  if (!panel) return;
  const root = document.createElement("div");
  root.className = CLASS;
  if (summary.totalPlays === 0 && summary.totalSeconds === 0) {
    element(root, "p", t("Nothing counted yet. Every track heard for 30 seconds or more counts.")).className =
      `${CLASS}-empty`;
  } else {
    const total = t("{plays} plays, {time} in all", { plays: summary.totalPlays, time: minutes(summary.totalSeconds) });
    element(root, "p", total).className = `${CLASS}-total`;
    const section = (title: string): HTMLElement => {
      const box = element(root, "section");
      element(box, "h3", title);
      return box;
    };
    const tracks = element(section(t("Most heard tracks")), "ol");
    // A track heard for less than 30 seconds so far has no play yet.
    for (const track of summary.topTracks.filter((counted) => counted.plays > 0)) {
      const item = element(tracks, "li", `${track.title} – ${track.artist} `);
      element(item, "small", t("{plays}×, {time}", { plays: track.plays, time: minutes(track.seconds) }));
    }
    const artists = element(section(t("Most heard artists")), "ol");
    for (const [name, counts] of summary.topArtists.filter(([, counted]) => counted.plays > 0)) {
      const item = element(artists, "li", `${name} `);
      element(item, "small", t("{plays}×, {time}", { plays: counts.plays, time: minutes(counts.seconds) }));
    }
    const chart = element(section(t("Listening time, last {days} days", { days: DAYS })), "div");
    chart.className = `${CLASS}-days`;
    // Days without listening are not stored, but get their place in the chart.
    const heard = new Map(summary.days);
    const days = lastDays(new Date(), DAYS).map((day): [string, number] => [day, heard.get(day) ?? 0]);
    const most = Math.max(1, ...days.map(([, seconds]) => seconds));
    for (const [day, seconds] of days) {
      const bar = element(chart, "div");
      bar.style.height = `${Math.round((seconds / most) * 100)}%`;
      bar.title = `${day}: ${minutes(seconds)}`;
    }
  }
  const row = element(root, "div");
  row.className = `${CLASS}-row`;
  element(row, "button", t("Refresh")).addEventListener("click", () => void refresh());
  const clear = element(row, "button", clearing ? t("Really delete everything?") : t("Delete statistics"));
  clear.addEventListener("click", () => {
    if (!clearing) {
      clearing = true;
      void refresh();
      return;
    }
    clearing = false;
    statsClear().then(refresh, (error: unknown) => console.warn("[stats] could not delete", error));
  });
  panel.body.replaceChildren(root);
}

async function refresh(): Promise<void> {
  // What plays now counts as well.
  record(listening.finish(new Date()));
  try {
    render(await statsSummary(DAYS));
  } catch (error) {
    console.warn("[stats] could not read the statistics", error);
  }
}

function trackOf(song: Song | null): { videoId: string; title: string; artist: string } | null {
  const videoId = api?.music.getVideoId();
  return song && videoId ? { videoId, title: song.title, artist: song.artist } : null;
}

const onLeave = (): void => record(listening.finish(new Date()));

const stats: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.ui.injectCss(CSS);
    listening.start(trackOf(api.music.getCurrentSong()), new Date());
    timer = setInterval(() => listening.tick(api?.music.getPlaybackState()?.paused === false), 1000);
    api.ui.addNavButton(t("Stats"), () => {
      if (panel?.open) {
        panel.hide();
      } else {
        panel?.show();
        clearing = false;
        void refresh();
      }
    });
    window.addEventListener("pagehide", onLeave);
  },

  onUIReady() {
    panel = api?.ui.addPanel(t("Stats"));
  },

  onSongChange(song) {
    record(listening.start(trackOf(song), new Date()));
  },

  onUnload() {
    clearInterval(timer);
    window.removeEventListener("pagehide", onLeave);
    record(listening.start(null, new Date()));
    api = panel = undefined;
  },
};

export default stats;

// SponsorBlock: skips crowd-sourced segments such as sponsors and non-music
// sections, using the public SponsorBlock API.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import manifest from "./plugin.json";
import {
  CATEGORY_LABELS,
  enabledCategories,
  formatDuration,
  parseSegments,
  segmentAt,
  segmentsUrl,
  type Segment,
} from "./segments";
import { t } from "../../core/i18n";

const POLL_MS = 250;

let api: PluginApi | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let videoId: string | null = null;
let segments: Segment[] = [];
const skipped = new Set<string>();

async function loadSegments(pluginApi: PluginApi, id: string): Promise<void> {
  const { status, data } = await pluginApi.net.getJson(await segmentsUrl(id));
  // 404 means no video with this hash prefix has segments.
  const loaded = status === 200 ? parseSegments(data, id) : [];
  // The track may have changed while the request was running.
  if (videoId === id) segments = loaded;
}

function tick(): void {
  if (!api) return;
  const pluginApi = api;

  const currentId = pluginApi.music.getVideoId();
  if (currentId !== videoId) {
    videoId = currentId;
    segments = [];
    skipped.clear();
    if (currentId) {
      loadSegments(pluginApi, currentId).catch((error: unknown) => {
        console.warn("[sponsorblock] could not load segments", error);
      });
    }
  }

  const playback = pluginApi.music.getPlaybackState();
  if (!playback || playback.paused) return;
  const settings = pluginApi.settings.getAll();
  const segment = segmentAt(segments, playback.positionSeconds, enabledCategories(settings), skipped);
  if (!segment) return;

  // Once skipped, a segment is left alone: seeking back into it plays it.
  skipped.add(segment.id);
  const end = Math.min(segment.end, playback.durationSeconds ?? segment.end);
  const length = Math.max(0, end - playback.positionSeconds);
  pluginApi.player.seekTo(end);
  const total = addSaved(pluginApi, length);
  if (settings.showNotice === true) {
    const label = CATEGORY_LABELS[segment.category] ?? segment.category;
    const text = t("Skipped {what}, {length} · {total} skipped so far", {
      what: t(label),
      length: formatDuration(length),
      total: formatDuration(total),
    });
    pluginApi.ui.showNotice(text, {
      label: t("Play it"),
      onClick: () => {
        pluginApi.player.seekTo(segment.start);
        addSaved(pluginApi, -length);
      },
    });
  }
}

/** Adds to the time skipped so far, which is kept across restarts, and returns the new total. */
function addSaved(pluginApi: PluginApi, seconds: number): number {
  const before = pluginApi.settings.get("savedSeconds");
  const total = Math.max(0, Math.round(((typeof before === "number" ? before : 0) + seconds) * 10) / 10);
  pluginApi.settings.update({ savedSeconds: total }).catch((error: unknown) => {
    console.warn("[sponsorblock] could not save the skipped time", error);
  });
  return total;
}

const sponsorblock: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    timer = setInterval(tick, POLL_MS);
  },

  onUnload() {
    clearInterval(timer);
    api = undefined;
    videoId = null;
    segments = [];
    skipped.clear();
  },
};

export default sponsorblock;

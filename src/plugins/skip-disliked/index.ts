// Skip disliked: goes on to the next track when one comes up that you gave a
// thumbs down.
import { parseManifest } from "../../core/plugin-manager/api";
import type { LikeStatus, Plugin, PluginApi } from "../../shared/types";
import manifest from "./plugin.json";
import { t } from "../../core/i18n";

const POLL_MS = 500;
/** After this many skips without a track in between that was kept, stop: the whole queue may be disliked. */
export const MAX_SKIPS_IN_A_ROW = 10;

/** Decides track by track whether to skip. */
export class Skipper {
  private judged: string | null = null;
  private inARow = 0;

  /**
   * Called repeatedly with the playing track and its rating, which is `null`
   * until the page knows it. Returns `true` once for a track to skip.
   */
  check(videoId: string | null, status: LikeStatus | null): boolean {
    if (videoId === null || status === null || videoId === this.judged) return false;
    this.judged = videoId;
    if (status !== "dislike") {
      this.inARow = 0;
      return false;
    }
    if (this.inARow >= MAX_SKIPS_IN_A_ROW) return false;
    this.inARow += 1;
    return true;
  }
}

let api: PluginApi | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let skipper = new Skipper();

function tick(): void {
  if (!api) return;
  if (!skipper.check(api.music.getVideoId(), api.music.getLikeStatus())) return;
  api.player.next();
  // The song's title is not named: it arrives after the rating and would still be the last one's.
  if (api.settings.get("showNotice") === true) api.ui.showNotice(t("Skipped a track you disliked"));
}

const skipDisliked: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    skipper = new Skipper();
    // The rating shows up a moment after the track, and there is no event for it.
    timer = setInterval(tick, POLL_MS);
  },

  onUnload() {
    clearInterval(timer);
    api = undefined;
  },
};

export default skipDisliked;

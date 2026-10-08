// Audio only: when a music video comes up, switches to its audio version, as
// the "Song" button above the player does. That saves the bandwidth and the
// processor time the picture takes.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import manifest from "./plugin.json";

const TOGGLE = "ytmusic-av-toggle";
const SONG_BUTTON = `${TOGGLE} .song-button`;
const VIDEO_BUTTON = `${TOGGLE} .video-button`;

/**
 * Remembers that the user clicked "Video". The video is another track with
 * its own id, which is only known once it has loaded. So the choice starts as
 * pending, settles on the id of the video that then plays, and ends when
 * something else is played.
 */
export class VideoChoice {
  private wanted: string | "pending" | null = null;

  /** The user clicked "Video". */
  choose(): void {
    this.wanted = "pending";
  }

  /** The user clicked "Song", or the plugin starts over. */
  clear(): void {
    this.wanted = null;
  }

  /** Whether the user wants the picture of what is playing now. */
  holdsFor(videoId: string | null, videoSelected: boolean): boolean {
    if (this.wanted === null) return false;
    if (this.wanted === "pending") {
      // Until the video has loaded, the page still shows the song.
      if (videoSelected && videoId !== null) this.wanted = videoId;
      return true;
    }
    if (this.wanted !== videoId) this.wanted = null;
    return this.wanted !== null;
  }
}

let api: PluginApi | undefined;
const choice = new VideoChoice();

function act(): void {
  if (!api) return;
  // The switch is only there for tracks that exist both ways.
  const toggle = document.querySelector(TOGGLE);
  const videoSelected = toggle?.getAttribute("is-video-playback-mode-selected") === "true";
  if (choice.holdsFor(api.music.getVideoId(), videoSelected)) return;
  if (videoSelected) document.querySelector<HTMLElement>(SONG_BUTTON)?.click();
}

function onClick(event: Event): void {
  // Only a real click counts, not the page's or this plugin's own.
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  if (event.target.closest(VIDEO_BUTTON)) choice.choose();
  else if (event.target.closest(SONG_BUTTON)) choice.clear();
}

const audioOnly: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    document.addEventListener("click", onClick, true);
    act();
  },

  // The switch shows up a moment after the song does, so playback events look again.
  onSongChange: act,
  onPlaybackChange: act,

  onUnload() {
    document.removeEventListener("click", onClick, true);
    api = undefined;
    choice.clear();
  },
};

export default audioOnly;

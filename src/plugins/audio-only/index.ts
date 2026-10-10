// Audio only: when a music video comes up, switches to its audio version, as
// the "Song" button above the player does. That saves the bandwidth and the
// processor time the picture takes.
//
// Without Premium that button is switched off: a music video has no audio
// version to go to. Then the picture is loaded as small as it gets and the
// cover is shown instead, see `picture.ts`.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import { COVER_CSS, SmallPicture, type QualityPlayer } from "./picture";
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
const picture = new SmallPicture();
let removeCoverCss: (() => void) | undefined;

const player = (): QualityPlayer | null => document.querySelector<HTMLElement & QualityPlayer>("#movie_player");

/** Whether the page lets nobody switch between song and video for what is playing. */
export function switchIsOff(toggle: Element | null): boolean {
  return toggle !== null && toggle.hasAttribute("toggle-disabled") && toggle.getAttribute("toggle-disabled") !== "false";
}

/** Without a song to switch to: the smallest picture, and the cover in its place. */
function hidePicture(): void {
  if (!api) return;
  removeCoverCss ??= api.ui.injectCss(COVER_CSS);
  // The cover replaces the picture only in video mode, and only there is a picture to make small.
  if (document.querySelector("ytmusic-player")?.hasAttribute("video-mode")) picture.lower(player());
}

function showPicture(): void {
  removeCoverCss?.();
  removeCoverCss = undefined;
  picture.restore(player());
}

function act(): void {
  if (!api) return;
  // The switch is only there for tracks that exist both ways.
  const toggle = document.querySelector(TOGGLE);
  if (switchIsOff(toggle)) {
    hidePicture();
    return;
  }
  showPicture();
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
    showPicture();
    api = undefined;
    choice.clear();
  },
};

export default audioOnly;

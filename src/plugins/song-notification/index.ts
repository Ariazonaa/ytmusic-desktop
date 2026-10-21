// Song notification: says which track starts, with its cover, as a
// notification of the operating system. Not while the app's window is in
// front, where the track is on screen anyway, and not for a track that only
// loads paused, as the one from last time does at start.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi, Song } from "../../shared/types";
import manifest from "./plugin.json";

/** Title and second line of the notification, or `null` for a track without a title. */
export function notificationFor(song: Song): { title: string; body: string } | null {
  const title = song.title.trim();
  if (!title) return null;
  return { title, body: [song.artist, song.album].map((part) => part.trim()).filter(Boolean).join(" – ") };
}

/** Whether the app's window is shown and has the focus. */
export function windowInFront(doc: Document = document): boolean {
  return doc.visibilityState === "visible" && doc.hasFocus();
}

let api: PluginApi | undefined;

const songNotification: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
  },

  onSongChange(song) {
    if (!api || windowInFront()) return;
    if (api.music.getPlaybackState()?.paused) return;
    const text = notificationFor(song);
    if (!text) return;
    // A notification within three seconds of the last one is refused: skipping fast shows the last one only.
    api.notify.show(text.title, text.body, { imageUrl: song.artworkUrl }).catch(() => {});
  },

  onUnload() {
    api = undefined;
  },
};

export default songNotification;

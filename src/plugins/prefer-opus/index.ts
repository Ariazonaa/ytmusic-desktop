// Prefer Opus: makes the player choose Opus audio instead of AAC.
//
// YouTube Music offers both and picks AAC. It asks the browser which formats
// it can play, so answering "no" for AAC leaves Opus as the best choice. The
// change applies to tracks loaded afterwards.
//
// This patches a browser function in the page, which no plugin permission
// covers. It is possible because built-in plugins run in the page itself.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin } from "../../shared/types";
import manifest from "./plugin.json";

/** Whether `type` is AAC audio, e.g. `audio/mp4; codecs="mp4a.40.2"`. */
export function isAac(type: string): boolean {
  return /^\s*audio\/mp4\b/i.test(type);
}

let original: typeof MediaSource.isTypeSupported | undefined;

const preferOpus: Plugin = {
  manifest: parseManifest(manifest),

  onLoad() {
    if (typeof MediaSource === "undefined" || original) return;
    original = MediaSource.isTypeSupported;
    const isSupported = original.bind(MediaSource);
    MediaSource.isTypeSupported = (type) => !isAac(type) && isSupported(type);
  },

  onUnload() {
    if (original) MediaSource.isTypeSupported = original;
    original = undefined;
  },
};

export default preferOpus;

// Ad blocker: no ads between tracks for accounts without Premium.
//
// YouTube Music asks its server for each track, and the answer says which ads
// belong to it. The plugin takes that part out of the answer before the
// player reads it, so the player never asks for an ad. Should one play
// anyway, it is skipped.
//
// This patches browser functions in the page, which no plugin permission
// covers. It is possible because built-in plugins run in the page itself. A
// track that was loaded before the plugin was switched on keeps its ads.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin } from "../../shared/types";
import manifest from "./plugin.json";
import { pruneAds } from "./prune";

const CHECK_INTERVAL_MS = 300;
const SKIP_BUTTONS = ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button";

/** The player while it shows an ad. */
const AD_PLAYER = "#movie_player.ad-showing";

/**
 * Ends the ad the player is showing, if any: with its skip button, or else
 * by jumping to its end. Returns whether there was one.
 */
export function skipShownAd(doc: Document = document): boolean {
  const player = doc.querySelector(AD_PLAYER);
  if (!player) return false;
  const button = player.querySelector<HTMLElement>(SKIP_BUTTONS);
  if (button) {
    button.click();
    return true;
  }
  const video = player.querySelector("video");
  if (video && Number.isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
  return true;
}

/** While false the patched functions behave like the original ones. */
let active = false;
let patched = false;
let timer: ReturnType<typeof setInterval> | undefined;

/**
 * Patches the two ways a page turns a server's answer into an object. Done
 * once: the patches stay when the plugin is switched off, because another
 * script may have wrapped them in the meantime, and then only pass through.
 */
function patch(): void {
  if (patched) return;
  patched = true;

  const parse = JSON.parse;
  JSON.parse = function (this: unknown, ...args: Parameters<typeof JSON.parse>) {
    const value: unknown = parse.apply(this, args);
    if (active) pruneAds(value);
    return value;
  };

  if (typeof Response === "undefined") return;
  const json = Response.prototype.json;
  Response.prototype.json = async function (this: Response) {
    const value: unknown = await json.call(this);
    if (active) pruneAds(value);
    return value;
  };
}

const adblock: Plugin = {
  manifest: parseManifest(manifest),

  onLoad() {
    patch();
    active = true;
    timer ??= setInterval(() => skipShownAd(), CHECK_INTERVAL_MS);
  },

  onUnload() {
    active = false;
    clearInterval(timer);
    timer = undefined;
  },
};

export default adblock;

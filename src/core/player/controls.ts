import type { PlayerAction } from "../../shared/types";
import { SELECTORS } from "../injector/dom";
import { findPlayer } from "./playback";
import { VOLUME_STEP, changeVolume, toggleMute } from "./volume";

/**
 * Jumps to a position in the current track.
 *
 * This goes through the player, which counts per track. The `<video>`
 * element's own clock runs on across tracks that play into each other.
 */
export function seekTo(seconds: number, doc: Document = document): void {
  if (!Number.isFinite(seconds)) return;
  const position = Math.max(0, seconds);
  const player = findPlayer(doc);
  if (player?.seekTo) {
    player.seekTo(position, true);
    return;
  }
  const video = doc.querySelector("video");
  if (video) video.currentTime = position;
}

const MIN_RATE = 0.25;
const MAX_RATE = 4;

/** Sets the playback speed, 1 being normal. */
export function setPlaybackRate(rate: number, preservePitch: boolean, doc: Document = document): void {
  const video = doc.querySelector("video");
  if (!video || !Number.isFinite(rate)) return;
  const clamped = Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
  // Assigning an unchanged rate would still fire `ratechange`.
  if (video.playbackRate !== clamped) video.playbackRate = clamped;
  if (video.preservesPitch !== preservePitch) video.preservesPitch = preservePitch;
}

/** Performs a player action requested from outside the page, e.g. by the tray menu. */
export function controlPlayer(action: PlayerAction, doc: Document = document): void {
  switch (action) {
    case "playPause": {
      const video = doc.querySelector("video");
      if (!video) return;
      if (video.paused) void video.play();
      else video.pause();
      return;
    }
    // YouTube Music owns the queue, so skipping goes through its own buttons.
    case "next":
      doc.querySelector<HTMLElement>(SELECTORS.nextButton)?.click();
      return;
    case "previous":
      doc.querySelector<HTMLElement>(SELECTORS.previousButton)?.click();
      return;
    case "volumeUp":
      changeVolume(VOLUME_STEP, doc);
      return;
    case "volumeDown":
      changeVolume(-VOLUME_STEP, doc);
      return;
    case "toggleMute":
      toggleMute(doc);
      return;
  }
}

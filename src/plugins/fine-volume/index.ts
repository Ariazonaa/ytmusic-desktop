// Fine volume: YouTube Music's slider turned into even steps of loudness.
//
// How the page turns its slider into loudness depends on the player bar. The
// older one has a curve in whole percent: silent below 5, the same from 5 to 9.
// The newer one is linear: 5 is already -26 dB, which is loud. Here the page's
// slider stays where the volume is set, by the tray, shortcuts and media keys
// alike, but the chain plays at a level of its own: each step on the slider is
// the same number of decibels.
//
// The plugin keeps the position itself. The newer bar shows the page's slider
// on another scale than it sets it: 44 reads 73 after a restart, 89 after
// unmuting. Going by that, it would get louder each time.
import { SELECTORS } from "../../core/injector/dom";
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import manifest from "./plugin.json";
import { t } from "../../core/i18n";

/**
 * The linear gain for a position of the slider: 100 is full volume, 0 is
 * silence, and in between each step is `rangeDb / 100` decibels.
 */
export function levelFor(slider: number, rangeDb: number): number {
  if (!(slider > 0)) return 0;
  if (slider >= 100) return 1;
  const range = Number.isFinite(rangeDb) && rangeDb > 0 ? rangeDb : 50;
  return 10 ** ((-range * (1 - slider / 100)) / 20);
}

/**
 * How far one notch of the wheel moves the slider: `step`, or 1 with Shift.
 * With Shift the browser turns the wheel sideways, so `deltaX` counts too.
 */
export function wheelDelta(event: WheelEvent, step: number): number {
  const delta = event.deltaY || event.deltaX;
  if (delta === 0) return 0;
  return (event.shiftKey ? 1 : step) * (delta < 0 ? 1 : -1);
}

/** Events after which the page's slider may stand elsewhere. Media events do not bubble, hence capturing. */
const SLIDER_EVENTS = ["change", "input", "value-change", "volumechange"] as const;

/**
 * The newer player bar's volume button, which holds the page's slider in a
 * popup. In the older one the slider sits in the bar itself.
 */
const VOLUME_BUTTON = ".ytMusicMiniPlayerVolumeWrapper";

/** How long the slider has to rest before its position is saved. */
const SAVE_AFTER_MS = 1000;

/** How long after unmuting the page may still be moving its slider. */
const UNMUTE_SETTLES_MS = 300;

// One slider of our own for both player bars, as theirs differ: small and shown
// only over the volume button, and in the newer one upright. The page's stays
// in place, hidden, as the app reads and sets the volume through it.
const CSS = `
ytmusic-player-bar .volume-slider.ytmusic-player-bar,
.ytMusicMiniPlayerVolumePopup {
  display: none !important;
}
ytmusic-player-bar #right-controls.ytmusic-player-bar {
  width: auto !important;
}
.ytMusicMiniPlayerHost:not(.ytMusicMiniPlayerHostSmallViewport) {
  grid-template-columns: minmax(0, 1fr) auto auto;
}
[data-fine-volume] {
  --fine-volume-color: var(--ytmusic-playback-progress-color, var(--ytmusic-text-primary, #fff));
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  margin: 0 4px;
  color: var(--ytmusic-text-secondary, #aaa);
  font-size: 11px;
  white-space: nowrap;
}
[data-fine-volume] input {
  appearance: none;
  width: 120px;
  height: 16px;
  margin: 0;
  background: transparent;
  cursor: pointer;
}
[data-fine-volume] input::-webkit-slider-runnable-track {
  height: 2px;
  border-radius: 1px;
  background: linear-gradient(
    to right,
    var(--fine-volume-color) var(--fine-volume-fill, 0%),
    var(--ytmusic-icon-inactive, #909090) var(--fine-volume-fill, 0%)
  );
}
[data-fine-volume] input::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--fine-volume-color);
}
[data-fine-volume] span {
  min-width: 4ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
/* Narrow windows have no room: the page's own controls stay. */
@media (max-width: 1149px) {
  [data-fine-volume] {
    display: none;
  }
}
`;

let api: PluginApi | undefined;
let bar: Element | undefined;
let control: HTMLElement | undefined;
let slider: HTMLInputElement | undefined;
let label: HTMLElement | undefined;
/** The position of the slider as far as we know. */
let volume: number | null = null;
/** Not until the saved position is back: the page's would be loud for a moment. */
let ready = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let wasMuted = false;
let unmuteTimer: ReturnType<typeof setTimeout> | undefined;

const setting = (key: string, fallback: number): number => {
  const value = api?.settings.get(key);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

function apply(position: number): void {
  volume = position;
  api?.audio.setVolumeLevel(levelFor(position, setting("range", 50)));
  if (slider) {
    slider.value = String(position);
    slider.style.setProperty("--fine-volume-fill", `${position}%`);
  }
  if (label) label.textContent = `${position} %`;
}

function save(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (volume !== null) api?.settings.update({ volume }).catch(() => {});
}

function saveSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_AFTER_MS);
}

/** Unmuting, the page works its slider out from the player's rounded volume: 30 comes back as 28. */
function afterUnmuting(): void {
  unmuteTimer = undefined;
  if (volume !== null) api?.player.setVolume(volume);
}

function update(event: Event): void {
  // Our own slider sets the volume itself, and is ahead of the page's until then.
  if (!api || !ready || event.target === slider) return;
  // Muted, the older bar's slider shows 0. The chain sees to the silence.
  if (document.querySelector("video")?.muted) {
    wasMuted = true;
    return;
  }
  if (wasMuted) {
    wasMuted = false;
    clearTimeout(unmuteTimer);
    unmuteTimer = setTimeout(afterUnmuting, UNMUTE_SETTLES_MS);
  }
  if (unmuteTimer !== undefined) return;
  const position = api.player.getVolume();
  if (position === null || position === volume) return;
  apply(position);
  saveSoon();
}

/** Moves the page's slider and ours. */
function setPosition(position: number): void {
  if (!api) return;
  const next = Math.min(100, Math.max(0, Math.round(position)));
  api.player.setVolume(next);
  apply(next);
  saveSoon();
}

function onSlider(): void {
  if (slider) setPosition(Number(slider.value));
}

function onWheel(event: Event): void {
  if (!api || !(event instanceof WheelEvent)) return;
  const delta = wheelDelta(event, setting("step", 2));
  const current = volume ?? api.player.getVolume();
  if (delta === 0 || current === null) return;
  // Otherwise the page behind the bar would scroll.
  event.preventDefault();
  setPosition(current + delta);
}

/**
 * Puts our slider before the volume button, or where the page's slider is.
 * The page rebuilds parts of the bar, as for an ad, which takes it out again.
 */
function placeControl(): void {
  if (!control || control.isConnected) return;
  const place = document.querySelector(VOLUME_BUTTON) ?? document.querySelector(SELECTORS.volumeSlider);
  place?.before(control);
}

function addControl(): void {
  if (control) return;
  control = document.createElement("div");
  control.dataset.fineVolume = "";
  slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  slider.setAttribute("aria-label", t("Volume"));
  slider.addEventListener("input", onSlider);
  label = document.createElement("span");
  control.append(slider, label);
  placeControl();
}

const fineVolume: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.ui.injectCss(CSS);
    for (const type of SLIDER_EVENTS) document.addEventListener(type, update, true);
    document.addEventListener("timeupdate", placeControl, true);
    const saved = setting("volume", -1);
    const start = saved >= 0 ? saved : api.player.getVolume();
    if (start !== null) apply(start);
  },

  onUIReady() {
    bar = document.querySelector(SELECTORS.playerBar) ?? undefined;
    // Not passive: the handler has to stop the page from scrolling.
    bar?.addEventListener("wheel", onWheel, { passive: false });
    addControl();
    const saved = setting("volume", -1);
    if (saved >= 0) api?.player.setVolume(saved);
    const start = saved >= 0 ? saved : (volume ?? api?.player.getVolume() ?? null);
    if (start !== null) apply(start);
    ready = true;
  },

  onSettingsChange() {
    if (volume !== null) apply(volume);
  },

  onUnload() {
    for (const type of SLIDER_EVENTS) document.removeEventListener(type, update, true);
    document.removeEventListener("timeupdate", placeControl, true);
    bar?.removeEventListener("wheel", onWheel);
    if (saveTimer !== undefined) save();
    clearTimeout(unmuteTimer);
    unmuteTimer = undefined;
    wasMuted = false;
    control?.remove();
    bar = control = slider = label = api = undefined;
    volume = null;
    ready = false;
  },
};

export default fineVolume;

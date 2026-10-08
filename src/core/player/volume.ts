import { SELECTORS } from "../injector/dom";

/** YouTube Music's volume sliders are custom elements with a numeric `value`. */
type Slider = HTMLElement & { value: number };

/** How far the tray menu's volume entries move the slider. */
export const VOLUME_STEP = 10;

const clamp = (percent: number): number => Math.min(100, Math.max(0, Math.round(percent)));

/**
 * The volume as shown on YouTube Music's slider, 0 to 100, or `null` before
 * the player bar exists.
 *
 * Volume goes through the page's own slider rather than the player: the page
 * maps the slider to loudness on a curve, shows the value and remembers it.
 * Setting the player directly would leave all of that out of step.
 */
export function getVolume(doc: Document = document): number | null {
  const slider = doc.querySelector<Slider>(SELECTORS.volumeSlider);
  return slider && Number.isFinite(Number(slider.value)) ? clamp(Number(slider.value)) : null;
}

/** Moves the slider to `percent` and lets the page apply it. Returns the new volume. */
export function setVolume(percent: number, doc: Document = document): number | null {
  const slider = doc.querySelector<Slider>(SELECTORS.volumeSlider);
  if (!slider || !Number.isFinite(percent)) return getVolume(doc);
  const volume = clamp(percent);
  slider.value = volume;
  // The page listens for the slider's own change event.
  slider.dispatchEvent(new CustomEvent("change", { bubbles: true }));
  // A second slider is shown when the window is narrow.
  const compact = doc.querySelector<Slider>(SELECTORS.compactVolumeSlider);
  if (compact) compact.value = volume;
  return volume;
}

/** Changes the volume by `delta` percentage points. Returns the new volume. */
export function changeVolume(delta: number, doc: Document = document): number | null {
  const current = getVolume(doc);
  return current === null ? null : setVolume(current + delta, doc);
}

/** The player's own volume. It keeps its value while muted, unlike the slider, which shows 0. */
function playerVolume(doc: Document): number | null {
  const player = doc.querySelector<HTMLElement & { getVolume?: () => number }>("#movie_player");
  return typeof player?.getVolume === "function" ? player.getVolume() : null;
}

/** What the slider and the player showed when `toggleMute` last muted. */
let beforeMute: { slider: number; player: number | null } | undefined;

/**
 * Mutes or unmutes through the page's own button, which keeps its icon right.
 *
 * On unmuting, the page works the slider's position out from the player's
 * coarser volume and lands a step or two lower (44 comes back as 43). So the
 * position is remembered when muting and put back afterwards, unless the
 * volume was changed in between.
 */
export function toggleMute(doc: Document = document): void {
  const button = doc.querySelector<HTMLElement>(SELECTORS.muteButton);
  if (!button) return;
  const slider = getVolume(doc);
  const player = playerVolume(doc);
  button.click();
  if (slider !== null && slider > 0) {
    beforeMute = { slider, player };
    return;
  }
  const remembered = beforeMute;
  beforeMute = undefined;
  if (remembered && remembered.player === player && getVolume(doc) !== remembered.slider) {
    setVolume(remembered.slider, doc);
  }
}

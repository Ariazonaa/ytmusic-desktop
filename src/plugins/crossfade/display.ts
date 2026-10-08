// With the crossfade on, the player is ahead of the sound. YouTube Music's
// time display and progress bar show the player's position, so they are
// corrected here to show what is heard.
import { SELECTORS } from "../../core/injector/dom";

/** Below this the difference is not worth touching the page for. */
const MIN_AHEAD_SECONDS = 0.3;

/** `m:ss`, or `h:mm:ss` from an hour on, as YouTube Music writes times. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const pad = (value: number): string => String(value).padStart(2, "0");
  const [hours, minutes, rest] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** Replaces the elapsed time in a text like `1:06 / 3:34`. Other texts are left alone. */
export function withElapsed(text: string, seconds: number): string {
  const match = /^(\s*)[\d:]+(\s*\/.*)$/s.exec(text);
  return match ? `${match[1] ?? ""}${formatTime(seconds)}${match[2] ?? ""}` : text;
}

type Slider = HTMLElement & { value: number; dragging?: boolean };

/** The text node inside `element` that holds a time like `1:06 / 3:34`. */
function textNodeOf(element: Element | null): Text | null {
  if (!element) return null;
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (/\d:\d\d/.test((node as Text).data)) return node as Text;
  }
  return null;
}

/**
 * Keeps the time display and the progress bar on the heard position.
 * `heard` returns it in seconds, or `null` to leave the page's own display.
 * Returns a function that stops correcting.
 */
export function correctDisplay(heard: () => { position: number; ahead: number } | null, doc: Document = document): () => void {
  const apply = (): void => {
    const state = heard();
    if (!state || state.ahead < MIN_AHEAD_SECONDS) return;
    // The page keeps updating its own text node. Replacing that node would cut
    // the display off from the page, so only its text is changed.
    const time = textNodeOf(doc.querySelector(SELECTORS.timeInfo));
    if (time) {
      const corrected = withElapsed(time.data, state.position);
      // Writing only on a difference keeps this from answering its own change.
      if (corrected !== time.data) time.data = corrected;
    }
    const bar = doc.querySelector<Slider>(SELECTORS.progressBar);
    // While the user drags the bar it shows where they are seeking to.
    if (bar && !bar.dragging && Math.abs(Number(bar.value) - state.position) > 0.5) {
      bar.value = Math.floor(state.position);
    }
  };

  // The page rewrites both whenever the player reports progress. Correcting
  // right after each rewrite means the uncorrected value is never painted.
  const observer = new MutationObserver(apply);
  const observe = (): void => {
    observer.disconnect();
    for (const selector of [SELECTORS.timeInfo, SELECTORS.progressBar]) {
      const element = doc.querySelector(selector);
      if (element) observer.observe(element, { attributes: true, childList: true, characterData: true, subtree: true });
    }
  };
  observe();
  // The elements appear with the player bar and may be replaced by the page.
  const timer = setInterval(() => {
    observe();
    apply();
  }, 1000);

  return () => {
    clearInterval(timer);
    observer.disconnect();
  };
}

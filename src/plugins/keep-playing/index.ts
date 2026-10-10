// Keep playing: no "Video paused. Continue watching?".
//
// When nobody has touched the mouse or the keyboard for about an hour,
// YouTube Music stops at the next track and asks whether anyone is still
// there. A music player that runs in the background all day gets that
// question all day.
//
// The page keeps the time of the last input in `window._lact` and compares it
// when a track starts. The plugin keeps that time fresh, so the question does
// not come up. Should it come up anyway, its button is pressed.
//
// This reaches into the page, which no plugin permission covers. It is
// possible because built-in plugins run in the page itself.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin } from "../../shared/types";
import manifest from "./plugin.json";

const INTERVAL_MS = 20_000;
const QUESTION = "ytmusic-you-there-renderer";

type Page = Window & { _lact?: unknown };

/** Tells the page there was input just now. Only where the page keeps that time at all. */
export function markActive(page: Page = window, now: number = Date.now()): void {
  if (typeof page._lact === "number") page._lact = now;
}

/** Answers the question if it is on screen. Returns whether it was. */
export function answerQuestion(doc: Document = document): boolean {
  const question = [...doc.querySelectorAll<HTMLElement>(QUESTION)].find(
    // A dialog that was answered stays in the page, closed.
    (candidate) => candidate.closest("[aria-hidden='true'], [hidden]") === null && candidate.getClientRects().length > 0,
  );
  if (!question) return false;
  const button = question.querySelector<HTMLElement>("button, [role='button']");
  button?.click();
  return true;
}

let timer: ReturnType<typeof setInterval> | undefined;

const keepPlaying: Plugin = {
  manifest: parseManifest(manifest),

  onLoad() {
    markActive();
    timer ??= setInterval(() => {
      markActive();
      answerQuestion();
    }, INTERVAL_MS);
  },

  onUnload() {
    clearInterval(timer);
    timer = undefined;
  },
};

export default keepPlaying;

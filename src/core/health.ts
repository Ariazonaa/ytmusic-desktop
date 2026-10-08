// Finds out what does not work, for the settings window to show: parts of
// YouTube Music's page the app relies on but cannot find, and errors of plugins.
import type { Health } from "../shared/types";
import { SELECTORS } from "./injector/dom";

/** What the app needs from the page, by a name the settings window explains. */
const PAGE_PARTS: Readonly<Record<string, string>> = {
  navBar: SELECTORS.navBar,
  playerBar: SELECTORS.playerBar,
  nextButton: SELECTORS.nextButton,
  previousButton: SELECTORS.previousButton,
  volumeSlider: SELECTORS.volumeSlider,
  muteButton: SELECTORS.muteButton,
  timeInfo: SELECTORS.timeInfo,
  progressBar: SELECTORS.progressBar,
  likeButtons: "ytmusic-player-bar ytmusic-like-button-renderer",
};

/** What the app calls on the player. */
const PLAYER_FUNCTIONS = ["getCurrentTime", "getVideoData", "getPlayerResponse", "seekTo"];

/**
 * Looks for everything the app relies on in the page and returns the names
 * of what is missing. YouTube Music changes without notice; this is how a
 * change shows up as a message instead of as a feature that silently stopped.
 */
export function checkPage(doc: Document = document): string[] {
  const missing = Object.entries(PAGE_PARTS)
    .filter(([, selector]) => doc.querySelector(selector) === null)
    .map(([name]) => name);
  const player = doc.querySelector("#movie_player") as (Element & Record<string, unknown>) | null;
  if (!player) return [...missing, "player"];
  return [
    ...missing,
    ...PLAYER_FUNCTIONS.filter((name) => typeof player[name] !== "function").map((name) => `player.${name}`),
  ];
}

const MAX_ERRORS_PER_PLUGIN = 5;
const REPORT_DELAY_MS = 500;

/**
 * Collects what does not work and hands it to `send`, a moment after the
 * last change so that a burst of errors makes one report.
 */
export class HealthReporter {
  private pageProblems: string[] = [];
  private readonly pluginErrors = new Map<string, string[]>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly send: (health: Health) => Promise<void>) {}

  setPageProblems(problems: readonly string[]): void {
    this.pageProblems = [...problems];
    this.schedule();
  }

  addPluginError(plugin: string, message: string): void {
    const errors = this.pluginErrors.get(plugin) ?? [];
    errors.push(message);
    this.pluginErrors.set(plugin, errors.slice(-MAX_ERRORS_PER_PLUGIN));
    this.schedule();
  }

  /** Forgets a plugin's errors, e.g. when it is switched on again. */
  clearPlugin(plugin: string): void {
    if (this.pluginErrors.delete(plugin)) this.schedule();
  }

  get current(): Health {
    return { pageProblems: [...this.pageProblems], pluginErrors: Object.fromEntries(this.pluginErrors) };
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // The settings window can do without the report; the log has the errors too.
      this.send(this.current).catch(() => {});
    }, REPORT_DELAY_MS);
  }
}

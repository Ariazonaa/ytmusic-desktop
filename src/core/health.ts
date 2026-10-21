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
  likeButtons: SELECTORS.likeButtons,
  // Beyond the player bar: there whenever a track plays, also while another page is open.
  playerArea: "ytmusic-player",
  songVideoSwitch: "ytmusic-av-toggle",
  queue: "ytmusic-player-queue",
  queueItems: "ytmusic-player-queue ytmusic-player-queue-item .song-title",
};

/** What plugins change the play queue through, see `addToQueue` in `player/queue.ts`. */
function missingQueueInternals(doc: Document): string[] {
  type Queue = Element & { dispatch?: unknown; queue?: { store?: { store?: { getState?: unknown } } } };
  const queue = doc.querySelector("ytmusic-player-queue") as Queue | null;
  if (!queue) return [];
  const app = doc.querySelector("ytmusic-app") as (Element & { networkManager?: { fetch?: unknown } }) | null;
  return [
    typeof queue.dispatch === "function" ? null : "queue.dispatch",
    typeof queue.queue?.store?.store?.getState === "function" ? null : "queue.store",
    typeof app?.networkManager?.fetch === "function" ? null : "app.networkManager",
  ].filter((name): name is string => name !== null);
}

/** What the app calls on the player. */
const PLAYER_FUNCTIONS = ["getCurrentTime", "getVideoData", "getPlayerResponse", "seekTo"];

/**
 * Looks for everything the app relies on in the page and returns the names
 * of what is missing. YouTube Music changes without notice; this is how a
 * change shows up as a message instead of as a feature that silently stopped.
 */
export function checkPage(doc: Document = document): string[] {
  const missing = [
    ...Object.entries(PAGE_PARTS)
      .filter(([, selector]) => doc.querySelector(selector) === null)
      .map(([name]) => name),
    ...missingQueueInternals(doc),
  ];
  const player = doc.querySelector("#movie_player") as (Element & Record<string, unknown>) | null;
  if (!player) return [...missing, "player"];
  return [
    ...missing,
    ...PLAYER_FUNCTIONS.filter((name) => typeof player[name] !== "function").map((name) => `player.${name}`),
  ];
}

/** After a song starts, the player bar needs a moment to be all there. */
const FIRST_LOOK_MS = 5000;
/** Something missing is looked for once more before it counts. */
const SECOND_LOOK_MS = 15000;

/**
 * Decides when to look at the page: a while after the first song, and again
 * at later songs for as long as something is missing, so that a message goes
 * away by itself once it is there. What is missing at the first look is
 * reported only if it is still missing at a second one: while a page loads,
 * the player bar can be absent for some seconds.
 */
export class PageCheck {
  private problems: string[] | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly report: (problems: string[]) => void,
    private readonly check: () => string[] = () => checkPage(),
  ) {}

  songChanged(): void {
    if (this.problems !== null && this.problems.length === 0) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.look(true), FIRST_LOOK_MS);
  }

  private look(again: boolean): void {
    const problems = this.check();
    if (problems.length > 0 && again) {
      this.timer = setTimeout(() => this.look(false), SECOND_LOOK_MS);
      return;
    }
    this.problems = problems;
    this.report(problems);
  }
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

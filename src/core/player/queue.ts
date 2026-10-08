import type { QueueItem } from "../../shared/types";

const ITEMS = "ytmusic-player-queue ytmusic-player-queue-item";
const MAX_ITEMS = 200;

type QueueElement = Element & { data?: { videoId?: unknown } };

/**
 * The play queue as YouTube Music lists it: what was played, the playing
 * track (`playing: true`) and what comes next, in order. Empty before a
 * queue exists. Text is taken as shown, so it is in the page's language.
 */
export function readQueue(doc: Document = document): QueueItem[] {
  return [...doc.querySelectorAll<QueueElement>(ITEMS)]
    // A track that exists as song and as video is in the page twice, the other version hidden.
    .filter((item) => item.closest("[hidden]") === null)
    .slice(0, MAX_ITEMS)
    .map((item) => {
    const text = (selector: string): string => item.querySelector(selector)?.textContent?.trim() ?? "";
    const videoId = item.data?.videoId;
    return {
      title: text(".song-title"),
      artist: text(".byline"),
      duration: text(".duration"),
      videoId: typeof videoId === "string" ? videoId : null,
      playing: item.hasAttribute("selected"),
    };
  });
}

const VIDEO_ID = /^[\w-]{6,20}$/;

/** The parts of YouTube Music the queue is changed through. They are internal to the page and may change. */
interface QueueInternals {
  queue: Element & { dispatch(action: unknown): void };
  getState(): { items?: unknown[]; nextQueueItemId?: unknown; queueContextParams?: unknown; selectedItemIndex?: unknown };
  fetch(path: string, body: unknown): Promise<{ queueDatas?: { content?: unknown }[] } | undefined>;
}

function findInternals(doc: Document): QueueInternals | null {
  // The page's store holds more than the queue; the queue's part is under `queue`.
  type Store = { getState?: () => { queue?: ReturnType<QueueInternals["getState"]> } };
  const queue = doc.querySelector("ytmusic-player-queue") as
    | (Element & { dispatch?: unknown; queue?: { store?: { store?: Store } } })
    | null;
  const app = doc.querySelector("ytmusic-app") as (Element & { networkManager?: { fetch?: unknown } }) | null;
  const store = queue?.queue?.store?.store;
  const network = app?.networkManager;
  if (!queue || typeof queue.dispatch !== "function" || typeof store?.getState !== "function") return null;
  if (!network || typeof network.fetch !== "function") return null;
  return {
    queue: queue as QueueInternals["queue"],
    getState: () => store.getState?.().queue ?? {},
    fetch: (path, body) => (network.fetch as QueueInternals["fetch"]).call(network, path, body),
  };
}

/**
 * Adds a track to the play queue: right after the playing one (`next`) or
 * behind everything queued (`end`). Rejects if the id is not a video id, if
 * YouTube Music does not know the track, or if there is no queue yet, which
 * is the case until something has been played.
 *
 * YouTube Music has no public way to do this. The track's queue entry is
 * asked from its server the way the "play next" menu entry does, and put
 * into the page's own queue store.
 */
export async function addToQueue(videoId: string, position: "next" | "end", doc: Document = document): Promise<void> {
  if (typeof videoId !== "string" || !VIDEO_ID.test(videoId)) throw new Error("not a video id");
  if (position !== "next" && position !== "end") throw new Error('position must be "next" or "end"');
  const internals = findInternals(doc);
  if (!internals) throw new Error("there is no play queue yet");
  const before = internals.getState();
  const answer = await internals
    .fetch("/music/get_queue", {
      queueContextParams: before.queueContextParams,
      // The server answers this position for every track; where the entry goes is decided below.
      queueInsertPosition: "INSERT_AFTER_CURRENT_VIDEO",
      videoIds: [videoId],
    })
    // The page rejects with an object of its own, which says nothing to a plugin.
    .catch(() => undefined);
  const items = (answer?.queueDatas ?? []).map((data) => data.content).filter((content) => content != null);
  if (items.length === 0) throw new Error("YouTube Music does not know this track");
  // The queue may have moved on while the request ran.
  const state = internals.getState();
  const length = Array.isArray(state.items) ? state.items.length : 0;
  const selected = typeof state.selectedItemIndex === "number" ? state.selectedItemIndex : -1;
  internals.queue.dispatch({
    type: "ADD_ITEMS",
    payload: {
      nextQueueItemId: state.nextQueueItemId,
      index: position === "next" ? Math.min(length, selected + 1) : length,
      items,
      shuffleEnabled: false,
      shouldAssignIds: true,
    },
  });
}

/**
 * Checks positions for a change to the queue and returns the queue's length.
 * Positions count as in `readQueue`. Only upcoming tracks may be changed: the
 * page keeps the playing track by its position, which a change in front of
 * it would shift.
 */
function upcomingPositions(internals: QueueInternals, positions: readonly number[]): void {
  const state = internals.getState();
  const length = Array.isArray(state.items) ? state.items.length : 0;
  const playing = typeof state.selectedItemIndex === "number" ? state.selectedItemIndex : -1;
  for (const position of positions) {
    if (!Number.isInteger(position) || position < 0 || position >= length) throw new Error("no track at this position");
    if (position <= playing) throw new Error("only tracks after the playing one can be changed");
  }
}

/**
 * Takes an upcoming track out of the play queue. `index` is its position in
 * `readQueue`. Throws for the playing track, for played ones and for a
 * position that does not exist.
 */
export function removeFromQueue(index: number, doc: Document = document): void {
  const internals = findInternals(doc);
  if (!internals) throw new Error("there is no play queue yet");
  upcomingPositions(internals, [index]);
  internals.queue.dispatch({ type: "REMOVE_ITEM", payload: index });
}

/**
 * Moves an upcoming track to another place among the upcoming ones. Both
 * positions count as in `readQueue`; `to` is where the track is afterwards.
 */
export function moveInQueue(from: number, to: number, doc: Document = document): void {
  const internals = findInternals(doc);
  if (!internals) throw new Error("there is no play queue yet");
  upcomingPositions(internals, [from, to]);
  if (from !== to) internals.queue.dispatch({ type: "MOVE_ITEM", payload: { fromIndex: from, toIndex: to } });
}

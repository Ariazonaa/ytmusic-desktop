// Remembers the playing track and where it was, and brings it back, paused,
// when the app starts again.
//
// YouTube Music itself puts the last track back into the player when it
// starts, at its beginning. Usually all that is left to do is to seek. Only
// if the page comes up with another track or none is the remembered one
// opened by its address.
import { findPlayer, type MoviePlayer } from "./playback";

/** Where to pick up again. */
export interface ResumePoint {
  videoId: string;
  /** The playlist or radio the track was played from, which restores the queue. */
  listId: string | null;
  positionSeconds: number;
}

const POINT_KEY = "ytmd-resume";
/** Set for the lifetime of the window: the app has started, later visits to the home page are the user's. */
const STARTED_KEY = "ytmd-started";
/** Carries the position across the navigation to the track. */
const PENDING_KEY = "ytmd-resume-pending";

const VIDEO_ID = /^[\w-]{6,20}$/;
const LIST_ID = /^[\w-]{2,100}$/;
const SAVE_EVERY_MS = 5000;
/** A track this close to its end starts over rather than ending at once. */
const END_MARGIN_SECONDS = 10;
/** How long the page gets to put a track into the player by itself. */
const OWN_RESTORE_MS = 12000;
/** How long an opened track gets to load. */
const LOAD_MS = 30000;
/** How long after seeking the track is kept from starting by itself. */
const HOLD_MS = 5000;

/** Reads a stored point. Anything that is not exactly a point is ignored: the page can write the storage too. */
export function parseResumePoint(text: string | null): ResumePoint | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { videoId, listId, positionSeconds } = value as Record<string, unknown>;
  if (typeof videoId !== "string" || !VIDEO_ID.test(videoId)) return null;
  if (typeof positionSeconds !== "number" || !Number.isFinite(positionSeconds) || positionSeconds < 0) return null;
  return {
    videoId,
    listId: typeof listId === "string" && LIST_ID.test(listId) ? listId : null,
    positionSeconds,
  };
}

/** The page that plays the point's track. */
export function resumeUrl(point: ResumePoint): string {
  const list = point.listId ? `&list=${encodeURIComponent(point.listId)}` : "";
  return `/watch?v=${encodeURIComponent(point.videoId)}${list}`;
}

/** Where in the track to continue, given its length if known. */
export function positionToRestore(point: ResumePoint, durationSeconds: number | null): number {
  if (durationSeconds !== null && point.positionSeconds > durationSeconds - END_MARGIN_SECONDS) return 0;
  return Math.floor(point.positionSeconds);
}

/**
 * Whether this page load is the app starting up on its home page. A track
 * the user opens themselves, or the home page visited later, is left alone.
 */
export function isFreshStart(location: Pick<Location, "pathname" | "search">, session: Pick<Storage, "getItem">): boolean {
  return session.getItem(STARTED_KEY) === null && location.pathname === "/" && location.search === "";
}

type Win = Window & typeof globalThis;

const loadedVideoId = (doc: Document): string | null => {
  const id = findPlayer(doc)?.getVideoData?.()?.video_id;
  return typeof id === "string" && id !== "" ? id : null;
};

const durationOf = (doc: Document): number | null => {
  const seconds = Number(findPlayer(doc)?.getPlayerResponse?.()?.videoDetails?.lengthSeconds);
  return seconds > 0 ? seconds : null;
};

function readPoint(doc: Document): ResumePoint | null {
  const player = findPlayer(doc) as (MoviePlayer & { getPlaylistId?: () => unknown }) | null;
  const position = player?.getCurrentTime?.();
  const videoId = loadedVideoId(doc);
  if (!doc.querySelector("video") || videoId === null || typeof position !== "number") return null;
  const fromPlayer = player?.getPlaylistId?.();
  const listId = typeof fromPlayer === "string" ? fromPlayer : new URLSearchParams(doc.location.search).get("list");
  return parseResumePoint(JSON.stringify({ videoId, listId, positionSeconds: position }));
}

async function waitFor(win: Win, timeoutMs: number, done: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => win.setTimeout(resolve, 250));
  }
  return true;
}

/**
 * Starts remembering the playing track. If the app has just started and
 * `enabled` is set, brings back the remembered track first.
 */
export function startResume(enabled: boolean, win: Win = window): void {
  const { document: doc, localStorage: local, sessionStorage: session } = win;
  const fresh = isFreshStart(win.location, session);
  session.setItem(STARTED_KEY, "1");

  // Set while a track is being brought back, so that its position is not
  // overwritten by the 0:00 the player starts at.
  let restoring = false;
  const finish = (): void => {
    restoring = false;
  };

  const pending = parseResumePoint(session.getItem(PENDING_KEY));
  session.removeItem(PENDING_KEY);
  const stored = parseResumePoint(local.getItem(POINT_KEY));
  if (pending) {
    // This page was opened to play the remembered track.
    restoring = true;
    void seekWhenLoaded(pending, win, LOAD_MS).finally(finish);
  } else if (fresh && enabled && stored) {
    restoring = true;
    void restoreAtStart(stored, win).finally(finish);
  }

  const save = (): void => {
    if (restoring) return;
    const point = readPoint(doc);
    // A track that has not started yet has nothing worth remembering.
    if (point && point.positionSeconds > 0) local.setItem(POINT_KEY, JSON.stringify(point));
  };
  win.setInterval(save, SAVE_EVERY_MS);
  doc.addEventListener("pause", save, true);
  win.addEventListener("pagehide", save);
}

async function restoreAtStart(point: ResumePoint, win: Win): Promise<void> {
  const doc = win.document;
  // Whatever the page loads by itself: is it the remembered track?
  await waitFor(win, OWN_RESTORE_MS, () => loadedVideoId(doc) !== null);
  if (loadedVideoId(doc) === point.videoId) {
    await seekWhenLoaded(point, win, LOAD_MS);
    return;
  }
  // The user may have gone somewhere in the meantime; then they are not interrupted.
  const untouched = win.location.pathname === "/" && doc.querySelector("video")?.paused !== false;
  if (untouched) {
    win.sessionStorage.setItem(PENDING_KEY, JSON.stringify(point));
    win.location.replace(resumeUrl(point));
  }
}

/** Waits for the track to load, seeks to the old position and keeps the track from starting by itself. */
async function seekWhenLoaded(point: ResumePoint, win: Win, timeoutMs: number): Promise<void> {
  const doc = win.document;
  // Seeking may make the player start. Until the user does something, it stays paused.
  let holding = true;
  const release = (): void => {
    holding = false;
  };
  const hold = (event: Event): void => {
    if (holding && event.target instanceof win.HTMLVideoElement) event.target.pause();
  };
  const inputs = ["pointerdown", "keydown"];
  doc.addEventListener("playing", hold, true);
  doc.addEventListener("play", hold, true);
  for (const type of inputs) doc.addEventListener(type, release, true);
  win.addEventListener("ytmd-control", release);

  const loaded = await waitFor(
    win,
    timeoutMs,
    () => loadedVideoId(doc) === point.videoId && durationOf(doc) !== null && doc.querySelector("video") !== null,
  );
  if (loaded && holding) {
    const position = positionToRestore(point, durationOf(doc));
    if (position > 0) findPlayer(doc)?.seekTo?.(position, true);
    await new Promise((resolve) => win.setTimeout(resolve, HOLD_MS));
  }

  release();
  doc.removeEventListener("playing", hold, true);
  doc.removeEventListener("play", hold, true);
  for (const type of inputs) doc.removeEventListener(type, release, true);
  win.removeEventListener("ytmd-control", release);
}

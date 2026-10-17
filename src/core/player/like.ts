import type { LikeStatus } from "../../shared/types";

/** The thumbs in the player bar. YouTube Music keeps the rating of the playing track on them. */
const LIKE_BUTTONS = "ytmusic-player-bar ytmusic-like-button-renderer";
/** The thumbs of the newer player bar: two toggle buttons, each saying whether it is pressed. */
const NEWER_THUMBS = "ytmusic-miniplayer segmented-like-dislike-button-view-model";

const STATUSES: Readonly<Record<string, LikeStatus>> = {
  LIKE: "like",
  DISLIKE: "dislike",
  INDIFFERENT: "none",
};

/**
 * How the user rated the playing track, or `null` while the page has not
 * said yet. The rating arrives a moment after the track does.
 */
export function readLikeStatus(doc: Document = document): LikeStatus | null {
  const thumbs = doc.querySelector(LIKE_BUTTONS);
  if (thumbs) {
    const status = thumbs.getAttribute("like-status");
    return status ? (STATUSES[status] ?? null) : null;
  }
  const [like, dislike] = newerThumbs(doc);
  if (!like || !dislike) return null;
  if (like.getAttribute("aria-pressed") === "true") return "like";
  return dislike.getAttribute("aria-pressed") === "true" ? "dislike" : "none";
}

/** The like and the dislike button of the newer player bar. */
function newerThumbs(doc: Document): (HTMLElement | undefined)[] {
  const box = doc.querySelector(NEWER_THUMBS);
  return [
    box?.querySelector<HTMLElement>("like-button-view-model button") ?? undefined,
    box?.querySelector<HTMLElement>("dislike-button-view-model button") ?? undefined,
  ];
}

/**
 * Rates the playing track by pressing the page's own thumbs, so that the
 * rating is saved to the account the way a click saves it. The first thumb
 * is "like", the second "dislike"; pressing the one that is set takes the
 * rating back. Returns whether the rating is as wanted or a thumb was
 * pressed to make it so; `false` means the page has no thumbs to press yet.
 */
export function setLikeStatus(status: LikeStatus, doc: Document = document): boolean {
  const current = readLikeStatus(doc);
  if (current === null) return false;
  if (current === status) return true;
  const buttons = doc.querySelector(LIKE_BUTTONS)
    ? [...doc.querySelectorAll<HTMLElement>(`${LIKE_BUTTONS} button`)]
    : newerThumbs(doc);
  const [like, dislike] = [buttons[0], buttons[1]];
  if (buttons.length !== 2 || !like || !dislike) return false;
  // Taking a rating back means pressing the thumb that is set.
  const press = status === "like" || (status === "none" && current === "like") ? like : dislike;
  press.click();
  return true;
}

import type { LikeStatus } from "../../shared/types";

/** The thumbs in the player bar. YouTube Music keeps the rating of the playing track on them. */
const LIKE_BUTTONS = "ytmusic-player-bar ytmusic-like-button-renderer";

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
  const status = doc.querySelector(LIKE_BUTTONS)?.getAttribute("like-status");
  return status ? (STATUSES[status] ?? null) : null;
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
  const buttons = doc.querySelectorAll<HTMLElement>(`${LIKE_BUTTONS} button`);
  const [like, dislike] = [buttons[0], buttons[1]];
  if (buttons.length !== 2 || !like || !dislike) return false;
  // Taking a rating back means pressing the thumb that is set.
  const press = status === "like" || (status === "none" && current === "like") ? like : dislike;
  press.click();
  return true;
}

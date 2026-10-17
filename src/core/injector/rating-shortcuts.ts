// The window's own shortcuts for rating the playing track: no plugin owns them.
import type { WindowShortcuts } from "../../shared/types";
import { readLikeStatus, setLikeStatus } from "../player/like";
import { addShortcut } from "./shortcuts";

let removers: (() => void)[] = [];
let applied = "";

/**
 * Registers the like and dislike shortcuts, in place of the ones before. Each
 * one sets its rating, or takes it back if the track has it already, as a
 * click on the thumb does.
 */
export function applyRatingShortcuts(shortcuts: WindowShortcuts | undefined, doc: Document = document): void {
  const key = JSON.stringify([shortcuts?.like ?? "", shortcuts?.dislike ?? ""]);
  if (key === applied) return;
  applied = key;
  for (const remove of removers.splice(0)) remove();
  for (const [status, keys] of [
    ["like", shortcuts?.like],
    ["dislike", shortcuts?.dislike],
  ] as const) {
    if (!keys) continue;
    try {
      removers.push(addShortcut(keys, () => setLikeStatus(readLikeStatus(doc) === status ? "none" : status, doc), doc));
    } catch (error) {
      console.warn(`[ytm-desktop] cannot use the shortcut for ${status}:`, error);
    }
  }
}

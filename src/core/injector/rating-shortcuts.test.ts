// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyRatingShortcuts } from "./rating-shortcuts";

/** The player bar's thumbs, which change the rating they show when pressed. */
function playerBar(doc: Document): HTMLElement {
  const bar = doc.createElement("ytmusic-player-bar");
  const rating = doc.createElement("ytmusic-like-button-renderer");
  rating.setAttribute("like-status", "INDIFFERENT");
  const like = doc.createElement("button");
  const dislike = doc.createElement("button");
  like.addEventListener("click", () =>
    rating.setAttribute("like-status", rating.getAttribute("like-status") === "LIKE" ? "INDIFFERENT" : "LIKE"),
  );
  dislike.addEventListener("click", () =>
    rating.setAttribute("like-status", rating.getAttribute("like-status") === "DISLIKE" ? "INDIFFERENT" : "DISLIKE"),
  );
  rating.append(like, dislike);
  bar.append(rating);
  doc.body.append(bar);
  return rating;
}

const press = (doc: Document, init: KeyboardEventInit): void => {
  doc.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
};

describe("applyRatingShortcuts", () => {
  it("likes and dislikes with its keys, and a second press takes it back", () => {
    const doc = document.implementation.createHTMLDocument("");
    const rating = playerBar(doc);
    applyRatingShortcuts({ like: "Ctrl+Shift+KeyL", dislike: "Ctrl+Shift+KeyD" }, doc);

    press(doc, { code: "KeyL", ctrlKey: true, shiftKey: true });
    expect(rating.getAttribute("like-status")).toBe("LIKE");
    press(doc, { code: "KeyD", ctrlKey: true, shiftKey: true });
    expect(rating.getAttribute("like-status")).toBe("DISLIKE");
    press(doc, { code: "KeyD", ctrlKey: true, shiftKey: true });
    expect(rating.getAttribute("like-status")).toBe("INDIFFERENT");
  });

  it("drops the keys it had when they change, and ignores what is not a shortcut", () => {
    const doc = document.implementation.createHTMLDocument("");
    const rating = playerBar(doc);
    applyRatingShortcuts({ like: "Ctrl+Shift+KeyL", dislike: "" }, doc);
    applyRatingShortcuts({ like: "Ctrl+Alt+KeyL", dislike: "Ctrl+KeyC" }, doc);

    press(doc, { code: "KeyL", ctrlKey: true, shiftKey: true });
    expect(rating.getAttribute("like-status")).toBe("INDIFFERENT");
    press(doc, { code: "KeyL", ctrlKey: true, altKey: true });
    expect(rating.getAttribute("like-status")).toBe("LIKE");
    // Ctrl+C is the window's own; it stays copying.
    press(doc, { code: "KeyC", ctrlKey: true });
    expect(rating.getAttribute("like-status")).toBe("LIKE");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import type { LikeStatus } from "../../shared/types";
import { readLikeStatus, setLikeStatus } from "./like";

/** Thumbs that behave like the page's: pressing the set one takes the rating back. */
function addThumbs(status: string | null, buttons = 2) {
  const bar = document.body.appendChild(document.createElement("ytmusic-player-bar"));
  const thumbs = bar.appendChild(document.createElement("ytmusic-like-button-renderer"));
  if (status !== null) thumbs.setAttribute("like-status", status);
  ["LIKE", "DISLIKE"].slice(0, buttons).forEach((own) => {
    const button = thumbs.appendChild(document.createElement("button"));
    button.addEventListener("click", () => {
      thumbs.setAttribute("like-status", thumbs.getAttribute("like-status") === own ? "INDIFFERENT" : own);
    });
  });
  return thumbs;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("readLikeStatus", () => {
  it("reads the rating from the player bar", () => {
    addThumbs("DISLIKE");
    expect(readLikeStatus()).toBe("dislike");
    document.body.replaceChildren();
    addThumbs("LIKE");
    expect(readLikeStatus()).toBe("like");
    document.body.replaceChildren();
    addThumbs("INDIFFERENT");
    expect(readLikeStatus()).toBe("none");
  });

  it("is null while the page has not said", () => {
    expect(readLikeStatus()).toBeNull();
    addThumbs(null);
    expect(readLikeStatus()).toBeNull();
    document.body.replaceChildren();
    addThumbs("SOMETHING_NEW");
    expect(readLikeStatus()).toBeNull();
  });
});

describe("setLikeStatus", () => {
  it("gets from every rating to every other", () => {
    const names: Record<LikeStatus, string> = { like: "LIKE", dislike: "DISLIKE", none: "INDIFFERENT" };
    for (const from of ["like", "dislike", "none"] as const) {
      for (const to of ["like", "dislike", "none"] as const) {
        document.body.replaceChildren();
        addThumbs(names[from]);
        expect(setLikeStatus(to), `${from} -> ${to}`).toBe(true);
        expect(readLikeStatus(), `${from} -> ${to}`).toBe(to);
      }
    }
  });

  it("does nothing when the page is not as expected", () => {
    expect(setLikeStatus("like")).toBe(false);
    addThumbs(null);
    expect(setLikeStatus("like")).toBe(false);
    document.body.replaceChildren();
    const thumbs = addThumbs("INDIFFERENT", 1);
    expect(setLikeStatus("like")).toBe(false);
    expect(thumbs.getAttribute("like-status")).toBe("INDIFFERENT");
  });
});

import { describe, expect, it } from "vitest";
import { MAX_SKIPS_IN_A_ROW, Skipper } from "./index";

describe("Skipper", () => {
  it("skips a disliked track once", () => {
    const skipper = new Skipper();
    expect(skipper.check("a", "dislike")).toBe(true);
    expect(skipper.check("a", "dislike")).toBe(false);
  });

  it("waits until the rating is known", () => {
    const skipper = new Skipper();
    expect(skipper.check("a", null)).toBe(false);
    expect(skipper.check(null, "dislike")).toBe(false);
    expect(skipper.check("a", "dislike")).toBe(true);
  });

  it("keeps liked and unrated tracks", () => {
    const skipper = new Skipper();
    expect(skipper.check("a", "like")).toBe(false);
    expect(skipper.check("b", "none")).toBe(false);
    // Disliking the playing track does not cut it off; it is skipped the next time it comes up.
    expect(skipper.check("b", "dislike")).toBe(false);
  });

  it("stops when everything is disliked, and starts again after a track that was kept", () => {
    const skipper = new Skipper();
    for (let i = 0; i < MAX_SKIPS_IN_A_ROW; i++) expect(skipper.check(`d${i}`, "dislike")).toBe(true);
    expect(skipper.check("one-more", "dislike")).toBe(false);
    expect(skipper.check("kept", "none")).toBe(false);
    expect(skipper.check("again", "dislike")).toBe(true);
  });
});

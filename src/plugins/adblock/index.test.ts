import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import adblock, { skipShownAd } from "./index";
import { pruneAds } from "./prune";

const RESPONSE = JSON.stringify({
  playabilityStatus: { status: "OK" },
  videoDetails: { videoId: "abc" },
  adPlacements: [{ adPlacementRenderer: {} }],
  playerAds: [{}],
  adSlots: [{}],
  adBreakHeartbeatParams: "Q0FB",
});

describe("pruneAds", () => {
  it("takes the ads out of a player response and leaves the rest", () => {
    const response = JSON.parse(RESPONSE) as Record<string, unknown>;
    expect(pruneAds(response)).toBe(true);
    expect(response).toEqual({ playabilityStatus: { status: "OK" }, videoDetails: { videoId: "abc" } });
    expect(pruneAds(response)).toBe(false);
  });

  it("finds a player response inside another answer", () => {
    const answer = { playerResponse: JSON.parse(RESPONSE) as Record<string, unknown>, other: 1 };
    expect(pruneAds(answer)).toBe(true);
    expect(Object.keys(answer.playerResponse)).toEqual(["playabilityStatus", "videoDetails"]);
  });

  it("leaves everything else alone", () => {
    for (const value of [null, 1, "adPlacements", ["adPlacements"], { ads: 1, playerResponse: "x" }]) {
      const before = JSON.stringify(value);
      expect(pruneAds(value)).toBe(false);
      expect(JSON.stringify(value)).toBe(before);
    }
  });
});

describe("adblock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    adblock.onUnload?.();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("prunes what the page parses while it is on, and only then", async () => {
    expect(JSON.parse(RESPONSE)).toHaveProperty("adPlacements");

    adblock.onLoad?.(undefined as never);
    expect(Object.keys(JSON.parse(RESPONSE) as object)).toEqual(["playabilityStatus", "videoDetails"]);
    expect(Object.keys((await new Response(RESPONSE).json()) as object)).toEqual(["playabilityStatus", "videoDetails"]);
    // A reviver still works.
    expect(JSON.parse('{"a":1}', (_key, value: unknown) => (typeof value === "number" ? value + 1 : value))).toEqual({ a: 2 });
    expect(() => JSON.parse("{")).toThrow(SyntaxError);

    adblock.onUnload?.();
    expect(JSON.parse(RESPONSE)).toHaveProperty("adPlacements");
    expect(await new Response(RESPONSE).json()).toHaveProperty("playerAds");

    adblock.onLoad?.(undefined as never);
    expect(JSON.parse(RESPONSE)).not.toHaveProperty("adPlacements");
  });

  function player(showingAd: boolean): { video: HTMLVideoElement; element: HTMLElement } {
    const element = document.createElement("div");
    element.id = "movie_player";
    if (showingAd) element.className = "ad-showing";
    const video = document.createElement("video");
    Object.defineProperty(video, "duration", { value: 15, configurable: true });
    element.append(video);
    document.body.append(element);
    return { video, element };
  }

  it("jumps to the end of an ad that plays anyway", () => {
    const { video, element } = player(true);
    adblock.onLoad?.(undefined as never);
    vi.advanceTimersByTime(400);
    expect(video.currentTime).toBe(15);

    // The track itself is not touched.
    video.currentTime = 3;
    element.className = "";
    vi.advanceTimersByTime(1000);
    expect(video.currentTime).toBe(3);
  });

  it("uses the skip button of an ad that has one", () => {
    const { video, element } = player(true);
    const button = document.createElement("button");
    button.className = "ytp-skip-ad-button";
    const clicked = vi.fn();
    button.addEventListener("click", clicked);
    element.append(button);
    expect(skipShownAd()).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(0);
  });

  it("does nothing without an ad, and nothing once switched off", () => {
    const { video, element } = player(false);
    expect(skipShownAd()).toBe(false);
    adblock.onLoad?.(undefined as never);
    adblock.onUnload?.();
    element.className = "ad-showing";
    vi.advanceTimersByTime(1000);
    expect(video.currentTime).toBe(0);
  });
});

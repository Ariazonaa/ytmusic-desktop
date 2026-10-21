import { describe, expect, it, vi } from "vitest";
import type { PluginApi, Song } from "../../shared/types";
import plugin, { notificationFor, windowInFront } from "./index";

const song = (title: string, artist = "Maroon 5", album = "V"): Song => ({
  title,
  artist,
  album,
  artworkUrl: "https://lh3.googleusercontent.com/abc=w544-h544",
});

function fakeApi(paused = false) {
  const show = vi.fn(() => Promise.resolve());
  const api = {
    music: { getPlaybackState: () => ({ paused, positionSeconds: 0, durationSeconds: 300 }) },
    notify: { show },
  } as unknown as PluginApi;
  return { api, show };
}

function inFront(front: boolean) {
  vi.spyOn(document, "hasFocus").mockReturnValue(front);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
}

describe("notificationFor", () => {
  it("has the title, and artist and album below", () => {
    expect(notificationFor(song(" Sugar "))).toEqual({ title: "Sugar", body: "Maroon 5 – V" });
    expect(notificationFor(song("Sugar", "Maroon 5", ""))).toEqual({ title: "Sugar", body: "Maroon 5" });
    expect(notificationFor(song("  "))).toBeNull();
  });
});

describe("song-notification", () => {
  it("shows the track with its cover while the window is not in front", () => {
    inFront(false);
    const { api, show } = fakeApi();
    plugin.onLoad?.(api);
    plugin.onSongChange?.(song("Sugar"));
    expect(show).toHaveBeenCalledWith("Sugar", "Maroon 5 – V", { imageUrl: "https://lh3.googleusercontent.com/abc=w544-h544" });
    plugin.onUnload?.();
  });

  it("stays quiet while the window is in front, or the track only loads paused", () => {
    inFront(true);
    expect(windowInFront()).toBe(true);
    const front = fakeApi();
    plugin.onLoad?.(front.api);
    plugin.onSongChange?.(song("Sugar"));
    expect(front.show).not.toHaveBeenCalled();
    plugin.onUnload?.();

    inFront(false);
    const paused = fakeApi(true);
    plugin.onLoad?.(paused.api);
    plugin.onSongChange?.(song("Sugar"));
    expect(paused.show).not.toHaveBeenCalled();
    plugin.onUnload?.();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavigationTarget } from "../../shared/types";
import { endpointFor, endpointForLink, navigate, openMusicLink } from "./navigate";

afterEach(() => {
  document.body.replaceChildren();
});

describe("endpointFor", () => {
  it("builds the request for each kind of page", () => {
    expect(endpointFor({ type: "search", query: "  rick astley " })).toEqual({ searchEndpoint: { query: "rick astley" } });
    expect(endpointFor({ type: "track", videoId: "dQw4w9WgXcQ" })).toEqual({ watchEndpoint: { videoId: "dQw4w9WgXcQ" } });
    expect(endpointFor({ type: "page", browseId: "FEmusic_home" })).toEqual({ browseEndpoint: { browseId: "FEmusic_home" } });
  });

  it("refuses targets that are not valid", () => {
    const bad: unknown[] = [
      { type: "search", query: "   " },
      { type: "search", query: "x".repeat(201) },
      { type: "search", query: 5 },
      { type: "track", videoId: "x" },
      { type: "track", videoId: "dQw4w9WgXcQ&list=evil" },
      { type: "page", browseId: "../settings" },
      { type: "url", url: "https://example.com" },
    ];
    for (const target of bad) expect(() => endpointFor(target as NavigationTarget), JSON.stringify(target)).toThrow();
  });
});

describe("navigate", () => {
  it("asks the app to go there", () => {
    const app = document.body.appendChild(document.createElement("ytmusic-app"));
    const onNavigate = vi.fn((event: Event) => (event as CustomEvent).detail);
    app.addEventListener("yt-navigate", onNavigate);
    navigate({ type: "search", query: "abba" });
    expect(onNavigate).toHaveReturnedWith({ endpoint: { searchEndpoint: { query: "abba" } } });
  });

  it("fails before the page is there, and sends nothing for a bad target", () => {
    expect(() => navigate({ type: "search", query: "abba" })).toThrow("has not loaded");
    const app = document.body.appendChild(document.createElement("ytmusic-app"));
    const onNavigate = vi.fn();
    app.addEventListener("yt-navigate", onNavigate);
    expect(() => navigate({ type: "track", videoId: "" })).toThrow();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("endpointForLink", () => {
  const link = (path: string) => endpointForLink(`https://music.youtube.com${path}`);

  it("reads the kinds of links YouTube Music has", () => {
    expect(link("/watch?v=dQw4w9WgXcQ")).toEqual({ watchEndpoint: { videoId: "dQw4w9WgXcQ" } });
    expect(link("/watch?v=dQw4w9WgXcQ&list=RDAMVM1")).toEqual({ watchEndpoint: { videoId: "dQw4w9WgXcQ", playlistId: "RDAMVM1" } });
    expect(link("/playlist?list=PL123")).toEqual({ browseEndpoint: { browseId: "VLPL123" } });
    expect(link("/browse/MPREb_abc")).toEqual({ browseEndpoint: { browseId: "MPREb_abc" } });
    expect(link("/channel/UC123/")).toEqual({ browseEndpoint: { browseId: "UC123" } });
    expect(link("/search?q=rick+astley")).toEqual({ searchEndpoint: { query: "rick astley" } });
    expect(link("/")).toEqual({ browseEndpoint: { browseId: "FEmusic_home" } });
    expect(link("/explore")).toEqual({ browseEndpoint: { browseId: "FEmusic_explore" } });
  });

  it("knows nothing else", () => {
    for (const other of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "http://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=x",
      "https://music.youtube.com/watch?list=PL1",
      "https://music.youtube.com/playlist",
      "https://music.youtube.com/search?q=",
      "https://music.youtube.com/browse/../x",
      "https://music.youtube.com/moods",
      "not a link",
    ]) {
      expect(endpointForLink(other), other).toBeNull();
    }
  });

  it("leaves out a playlist that is not one", () => {
    expect(link("/watch?v=dQw4w9WgXcQ&list=a%26b")).toEqual({ watchEndpoint: { videoId: "dQw4w9WgXcQ" } });
  });
});

describe("openMusicLink", () => {
  it("goes there inside the page when it knows the link", () => {
    const app = document.createElement("ytmusic-app");
    document.body.append(app);
    const seen = vi.fn();
    app.addEventListener("yt-navigate", (event) => seen((event as CustomEvent).detail));
    const load = vi.fn();
    openMusicLink("https://music.youtube.com/watch?v=dQw4w9WgXcQ", document, load);
    expect(seen).toHaveBeenCalledWith({ endpoint: { watchEndpoint: { videoId: "dQw4w9WgXcQ" } } });
    expect(load).not.toHaveBeenCalled();
  });

  it("loads a link it does not know, and one before the page is there", () => {
    const load = vi.fn();
    openMusicLink("https://music.youtube.com/watch?v=dQw4w9WgXcQ", document, load);
    document.body.append(document.createElement("ytmusic-app"));
    openMusicLink("https://music.youtube.com/podcasts", document, load);
    expect(load.mock.calls).toEqual([["https://music.youtube.com/watch?v=dQw4w9WgXcQ"], ["https://music.youtube.com/podcasts"]]);
  });

  it("loads nothing from elsewhere", () => {
    const load = vi.fn();
    openMusicLink("https://example.com/", document, load);
    openMusicLink("not a link", document, load);
    expect(load).not.toHaveBeenCalled();
  });
});

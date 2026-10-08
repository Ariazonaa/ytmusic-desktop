import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavigationTarget } from "../../shared/types";
import { endpointFor, navigate } from "./navigate";

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

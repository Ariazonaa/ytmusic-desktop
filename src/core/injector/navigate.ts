import type { NavigationTarget } from "../../shared/types";

const VIDEO_ID = /^[\w-]{6,20}$/;
/** Browse ids name albums (`MPREb_…`), artists and channels (`UC…`), playlists (`VL…`) and built-in pages (`FEmusic_…`). */
const BROWSE_ID = /^[\w-]{2,100}$/;
const MAX_QUERY_LENGTH = 200;

/** The request YouTube Music's own links carry for a target. Throws if the target is not a valid one. */
export function endpointFor(target: NavigationTarget): Record<string, unknown> {
  switch (target.type) {
    case "search": {
      const query = typeof target.query === "string" ? target.query.trim() : "";
      if (query === "" || query.length > MAX_QUERY_LENGTH) throw new Error("search needs a query of at most 200 characters");
      return { searchEndpoint: { query } };
    }
    case "track":
      if (typeof target.videoId !== "string" || !VIDEO_ID.test(target.videoId)) throw new Error("not a video id");
      return { watchEndpoint: { videoId: target.videoId } };
    case "page":
      if (typeof target.browseId !== "string" || !BROWSE_ID.test(target.browseId)) throw new Error("not a browse id");
      return { browseEndpoint: { browseId: target.browseId } };
    default:
      throw new Error("unknown kind of page");
  }
}

/**
 * Goes to a page of YouTube Music the way its own links do: inside the app,
 * without loading the site again, so the music keeps playing. Opening a track
 * plays it. Throws for an invalid target or before the page is there.
 */
export function navigate(target: NavigationTarget, doc: Document = document): void {
  const endpoint = endpointFor(target);
  const app = doc.querySelector("ytmusic-app");
  if (!app) throw new Error("YouTube Music has not loaded yet");
  app.dispatchEvent(new CustomEvent("yt-navigate", { bubbles: true, composed: true, detail: { endpoint } }));
}

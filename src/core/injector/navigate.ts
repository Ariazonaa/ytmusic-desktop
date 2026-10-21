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

/** Pages with a path of their own, as YouTube Music's own links have them. */
const PAGES: Readonly<Record<string, string>> = {
  "": "FEmusic_home",
  "/explore": "FEmusic_explore",
  "/library": "FEmusic_library_landing",
  "/charts": "FEmusic_charts",
  "/moods_and_genres": "FEmusic_moods_and_genres",
  "/new_releases": "FEmusic_new_releases",
};

/**
 * The request behind a link to YouTube Music, as its own links carry it, or
 * null for a link that is not one of the kinds it knows: a track (with its
 * playlist), a playlist, an album, artist or channel, a search, a main page.
 */
export function endpointForLink(link: string): Record<string, unknown> | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "music.youtube.com") return null;
  const path = url.pathname.replace(/\/+$/, "");
  const params = url.searchParams;
  const list = params.get("list");
  const playlistId = list !== null && BROWSE_ID.test(list) ? list : null;
  if (path === "/watch") {
    const videoId = params.get("v");
    if (videoId === null || !VIDEO_ID.test(videoId)) return null;
    return { watchEndpoint: playlistId ? { videoId, playlistId } : { videoId } };
  }
  if (path === "/playlist") return playlistId ? { browseEndpoint: { browseId: `VL${playlistId}` } } : null;
  const page = /^\/(?:browse|channel)\/([\w-]+)$/.exec(path);
  if (page?.[1]) return endpointFor({ type: "page", browseId: page[1] });
  if (path === "/search") {
    try {
      return endpointFor({ type: "search", query: params.get("q") ?? "" });
    } catch {
      return null;
    }
  }
  const browseId = PAGES[path];
  return browseId ? { browseEndpoint: { browseId } } : null;
}

/**
 * Opens a link to YouTube Music the way its own links do, so the music plays
 * on and the page does not ask whether to leave. A link of another kind, or
 * one before the page is there, loads the page.
 */
export function openMusicLink(link: string, doc: Document = document, load = (url: string) => location.assign(url)): void {
  const endpoint = endpointForLink(link);
  const app = doc.querySelector("ytmusic-app");
  if (endpoint && app) {
    app.dispatchEvent(new CustomEvent("yt-navigate", { bubbles: true, composed: true, detail: { endpoint } }));
  } else if (URL.canParse(link) && new URL(link).hostname === "music.youtube.com") {
    load(link);
  }
}

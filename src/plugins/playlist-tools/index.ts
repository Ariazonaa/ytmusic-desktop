// Playlist tools: the open playlist as a text file or a CSV for a
// spreadsheet, and which of its tracks are in it more than once.
import { parseManifest } from "../../core/plugin-manager/api";
import { saveText } from "../../core/settings/client";
import { t } from "../../core/i18n";
import type { Panel, Plugin, PluginApi } from "../../shared/types";
import { asCsv, asText, doubles, readAnswer, type PlaylistTrack } from "./tracks";
import manifest from "./plugin.json";

const CLASS = "ytmd-playlist-tools";
/** A playlist this long is longer than anyone's; the rest is left out. */
const MAX_PAGES = 100;

const CSS = `
.${CLASS} { padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 13px; }
.${CLASS} p { margin: 0; color: rgba(255, 255, 255, 0.75); }
.${CLASS} h3 { margin: 4px 0 0; font-size: 13px; font-weight: 600; color: rgba(255, 255, 255, 0.7); text-transform: uppercase; letter-spacing: 0.04em; }
.${CLASS} ul { margin: 0; padding-left: 18px; }
.${CLASS} li { margin-bottom: 4px; }
.${CLASS} li small { color: rgba(255, 255, 255, 0.6); }
.${CLASS}-row { display: flex; gap: 8px; flex-wrap: wrap; }
.${CLASS}-row button { padding: 6px 10px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: #1c1c1c; color: #fff; font: inherit; cursor: pointer; }
.${CLASS}-row button:disabled { opacity: 0.4; cursor: default; }
`;

type Fetch = (path: string, body: unknown) => Promise<unknown>;

let api: PluginApi | undefined;
let panel: Panel | undefined;
let loaded: { list: string; name: string; tracks: PlaylistTrack[] } | null = null;
let busy = false;
let message = "";

/** The id of the playlist the page shows, if it shows one. */
function openPlaylist(): string | null {
  if (location.pathname !== "/playlist") return null;
  const list = new URLSearchParams(location.search).get("list");
  return list && /^[\w-]{2,100}$/.test(list) ? list : null;
}

/** The page's own way to ask YouTube Music's server. Internal to the page; it may change. */
function pageFetch(): Fetch | null {
  const app = document.querySelector("ytmusic-app") as (Element & { networkManager?: { fetch?: unknown } }) | null;
  const network = app?.networkManager;
  if (!network || typeof network.fetch !== "function") return null;
  return (path, body) => (network.fetch as Fetch).call(network, path, body);
}

/** All tracks of `list`, part after part. */
async function loadTracks(fetch: Fetch, list: string): Promise<PlaylistTrack[]> {
  const browseId = list.startsWith("VL") ? list : `VL${list}`;
  let answer = readAnswer(await fetch("/browse", { browseId }));
  const tracks = [...answer.tracks];
  for (let page = 1; answer.next && page < MAX_PAGES; page++) {
    const token = answer.next;
    answer = readAnswer(await fetch("/browse", { continuation: token }).catch(() => null));
    // Older answers want the token in the address instead.
    if (answer.tracks.length === 0) {
      const query = `ctoken=${encodeURIComponent(token)}&continuation=${encodeURIComponent(token)}&type=next`;
      answer = readAnswer(await fetch(`/browse?${query}`, {}).catch(() => null));
    }
    if (answer.tracks.length === 0) break;
    tracks.push(...answer.tracks);
  }
  return tracks;
}

function playlistName(): string {
  const header = document.querySelector("ytmusic-responsive-header-renderer h1, ytmusic-detail-header-renderer h2");
  return header?.textContent?.trim() || t("Playlist");
}

async function load(): Promise<void> {
  const list = openPlaylist();
  const fetch = pageFetch();
  if (!list || !fetch) return;
  busy = true;
  message = "";
  render();
  try {
    loaded = { list, name: playlistName(), tracks: await loadTracks(fetch, list) };
  } catch {
    message = t("YouTube Music did not hand out the playlist.");
  }
  busy = false;
  render();
}

function save(kind: "txt" | "csv"): void {
  if (!loaded) return;
  const text = kind === "txt" ? asText(loaded.name, loaded.tracks) : asCsv(loaded.tracks);
  saveText(loaded.name, kind, text).then(
    (saved) => {
      message = saved ? t("Saved.") : "";
      render();
    },
    (reason: unknown) => {
      message = t("Could not save the file: {reason}", { reason: String(reason) });
      render();
    },
  );
}

function element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text?: string): HTMLElementTagNameMap[K] {
  const created = parent.appendChild(document.createElement(tag));
  if (text !== undefined) created.textContent = text;
  return created;
}

function button(row: HTMLElement, label: string, onClick: () => void, disabled = false): void {
  const created = element(row, "button", label);
  created.type = "button";
  created.disabled = disabled;
  created.addEventListener("click", onClick);
}

function render(): void {
  if (!panel) return;
  const root = document.createElement("div");
  root.className = CLASS;
  const list = openPlaylist();
  if (!list) {
    element(root, "p", t("Open a playlist, then come back here."));
  } else if (loaded?.list !== list) {
    element(root, "p", t("Reads the whole playlist, also the part not shown yet."));
    const row = element(root, "div");
    row.className = `${CLASS}-row`;
    button(row, busy ? t("Loading…") : t("Read the playlist"), () => void load(), busy);
  } else {
    element(root, "p", t("{count} tracks in “{name}”.", { count: loaded.tracks.length, name: loaded.name }));
    const row = element(root, "div");
    row.className = `${CLASS}-row`;
    button(row, t("Save as text"), () => save("txt"));
    button(row, t("Save as CSV"), () => save("csv"));
    button(row, t("Read again"), () => void load(), busy);
    const found = doubles(loaded.tracks);
    element(root, "h3", t("More than once"));
    if (found.length === 0) {
      element(root, "p", t("Every track is in the playlist once."));
    } else {
      const items = element(root, "ul");
      for (const group of found) {
        const item = element(items, "li", `${group.track.artist} – ${group.track.title} `);
        element(item, "small", t("at {positions}", { positions: group.positions.join(", ") }));
      }
    }
  }
  if (message) element(root, "p", message);
  panel.body.replaceChildren(root);
}

/** The page moved to another playlist or away: what was read belongs to the old one. */
const onNavigate = (): void => {
  if (panel?.open) render();
};

const playlistTools: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.ui.injectCss(CSS);
    api.ui.addNavButton(t("Playlist"), () => {
      if (panel?.open) {
        panel.hide();
      } else {
        panel?.show();
        message = "";
        render();
      }
    });
    document.addEventListener("yt-navigate-finish", onNavigate);
  },

  onUIReady() {
    panel = api?.ui.addPanel(t("Playlist tools"));
  },

  onUnload() {
    document.removeEventListener("yt-navigate-finish", onNavigate);
    api = panel = undefined;
    loaded = null;
  },
};

export default playlistTools;

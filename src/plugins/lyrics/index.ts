// Lyrics: a side panel with time-synced lyrics from LRCLIB, falling back to
// plain lyrics from lyrics.ovh. The current line is highlighted and clicking a
// line jumps to it.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Panel, Plugin, PluginApi, Song } from "../../shared/types";
import { activeLineIndex, type Lyrics } from "./lrc";
import { OFFSET_STEP_SECONDS, describeOffset, parseOffsets, withOffset } from "./offsets";
import manifest from "./plugin.json";
import { findLyrics } from "./sources";
import { t } from "../../core/i18n";

const BODY_CLASS = "ytmd-lyrics";
const TOOLS_CLASS = "ytmd-lyrics-tools";
/** Set on the panel while the lyrics fill the window. */
const LARGE_CLASS = "ytmd-lyrics-large";
const POLL_MS = 250;

const CSS = `
.${BODY_CLASS} {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  font-size: var(--ytmd-lyrics-size, 16px);
  scrollbar-width: thin;
}
.${BODY_CLASS} p {
  margin: 0 0 0.6em;
  color: rgba(255, 255, 255, 0.5);
  white-space: pre-wrap;
}
.${BODY_CLASS} p.ytmd-lyrics-synced { cursor: pointer; transition: color 0.2s; }
.${BODY_CLASS} p.ytmd-lyrics-synced:hover { color: rgba(255, 255, 255, 0.8); }
.${BODY_CLASS} p.ytmd-lyrics-active { color: #fff; font-weight: 500; }
.${BODY_CLASS} p.ytmd-lyrics-plain, .${BODY_CLASS} p.ytmd-lyrics-status { color: rgba(255, 255, 255, 0.8); }
.${TOOLS_CLASS} {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}
.${TOOLS_CLASS} button {
  padding: 3px 9px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  background: #1c1c1c;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
.${TOOLS_CLASS} button:disabled { opacity: 0.4; cursor: default; }
.${TOOLS_CLASS} output { min-width: 44px; text-align: center; color: #fff; font-variant-numeric: tabular-nums; }
.${TOOLS_CLASS} .ytmd-lyrics-spacer { flex: 1; }
/* The large view: the panel covers the page between the bars, the text is big and centered. */
.${LARGE_CLASS} { left: 0; width: auto !important; border-left: 0 !important; }
.${LARGE_CLASS} .${BODY_CLASS} {
  padding: 32px max(24px, 12vw);
  font-size: var(--ytmd-lyrics-large-size, 34px);
  line-height: 1.35;
  text-align: center;
}
`;

let api: PluginApi | undefined;
let panel: Panel | undefined;
let body: HTMLElement | undefined;
let offsetOutput: HTMLOutputElement | undefined;
let removeShortcut: (() => void) | undefined;
let offsetButtons: HTMLButtonElement[] = [];
/** The track the shown lyrics belong to, and how far they are shifted: positive shows them later. */
let lyricsVideoId: string | null = null;
let offset = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let lyrics: Lyrics | null = null;
let lineElements: HTMLElement[] = [];
let activeIndex = -1;
/** Identifies the latest lyrics request, so a slow response for an old song is dropped. */
let request = 0;

function showStatus(text: string): void {
  if (!body) return;
  const status = document.createElement("p");
  status.className = "ytmd-lyrics-status";
  status.textContent = text;
  body.replaceChildren(status);
  lineElements = [];
  activeIndex = -1;
}

function showLyrics(found: Lyrics): void {
  if (!body || !api) return;
  const player = api.player;
  lineElements = [];
  activeIndex = -1;
  if (found.synced) {
    lineElements = found.synced.map((line) => {
      const element = document.createElement("p");
      element.className = "ytmd-lyrics-synced";
      // An empty line marks an instrumental break.
      element.textContent = line.text || "♪";
      element.addEventListener("click", () => player.seekTo(Math.max(0, line.time + offset)));
      return element;
    });
    body.replaceChildren(...lineElements);
  } else {
    const text = document.createElement("p");
    text.className = "ytmd-lyrics-plain";
    text.textContent = found.plain;
    body.replaceChildren(text);
  }
  body.scrollTop = 0;
}

async function loadLyrics(pluginApi: PluginApi, song: Song): Promise<void> {
  const current = ++request;
  lyrics = null;
  lyricsVideoId = pluginApi.music.getVideoId();
  offset = (lyricsVideoId && parseOffsets(pluginApi.settings.get("offsets")).get(lyricsVideoId)) || 0;
  showOffset();
  showStatus(t("Loading lyrics…"));
  panel?.setTitle(t("Lyrics"));
  try {
    const found = await findLyrics(
      (url) => pluginApi.net.getJson(url),
      song,
      () => pluginApi.music.getPlaybackState()?.durationSeconds ?? null,
    );
    if (current !== request) return;
    lyrics = found?.lyrics ?? null;
    showOffset();
    if (found) {
      showLyrics(found.lyrics);
      panel?.setTitle(t("Lyrics"), found.source);
    } else {
      showStatus(t("No lyrics found."));
    }
  } catch (error) {
    if (current !== request) return;
    console.warn("[lyrics] could not load lyrics", error);
    showStatus(t("Could not load lyrics."));
  }
}

/** Highlights the line being sung and keeps it in the middle of the panel. */
function tick(): void {
  if (!api || !panel?.open || !body || !lyrics?.synced) return;
  const position = api.music.getPlaybackState()?.positionSeconds;
  if (position === undefined) return;
  const index = activeLineIndex(lyrics.synced, position - offset);
  if (index === activeIndex) return;
  lineElements[activeIndex]?.classList.remove("ytmd-lyrics-active");
  activeIndex = index;
  const line = lineElements[index];
  if (!line) return;
  line.classList.add("ytmd-lyrics-active");
  body.scrollTo({
    top: line.offsetTop - body.offsetTop - body.clientHeight / 2 + line.clientHeight / 2,
    behavior: "smooth",
  });
}

function open(): void {
  if (!panel) return;
  // Forces the next tick to scroll to the current line.
  lineElements[activeIndex]?.classList.remove("ytmd-lyrics-active");
  activeIndex = -1;
  panel.show();
}

function toggle(): void {
  if (panel?.open) panel.hide();
  else open();
}

/** Registers the shortcut from the settings, in place of the one before. */
function applyShortcut(): void {
  removeShortcut?.();
  removeShortcut = undefined;
  const shortcut = api?.settings.get("shortcut");
  if (api && typeof shortcut === "string" && shortcut !== "") removeShortcut = api.ui.addShortcut(shortcut, toggle);
}

function applyFontSize(): void {
  body?.style.setProperty("--ytmd-lyrics-size", `${String(api?.settings.get("fontSize") ?? 16)}px`);
  body?.style.setProperty("--ytmd-lyrics-large-size", `${String(api?.settings.get("largeFontSize") ?? 34)}px`);
}

/** Shows the correction; it only applies to lyrics that have times. */
function showOffset(): void {
  if (offsetOutput) offsetOutput.textContent = describeOffset(offset);
  for (const button of offsetButtons) button.disabled = !lyrics?.synced;
}

/** Shifts the lyrics of the playing track and remembers that for it. */
function changeOffset(pluginApi: PluginApi, change: number | "reset"): void {
  if (!lyricsVideoId || !lyrics?.synced) return;
  const stored = parseOffsets(pluginApi.settings.get("offsets"));
  const text = withOffset(stored, lyricsVideoId, change === "reset" ? 0 : offset + change);
  offset = parseOffsets(text).get(lyricsVideoId) ?? 0;
  showOffset();
  // Forces the next tick to pick the line again.
  lineElements[activeIndex]?.classList.remove("ytmd-lyrics-active");
  activeIndex = -1;
  pluginApi.settings.update({ offsets: text }).catch((error: unknown) => {
    console.warn("[lyrics] could not save the correction", error);
  });
}

/** The row above the lyrics: timing correction on the left, the large view on the right. */
function buildTools(pluginApi: PluginApi, container: HTMLElement): void {
  const tools = container.appendChild(document.createElement("div"));
  tools.className = TOOLS_CLASS;
  const button = (label: string, title: string, run: () => void): HTMLButtonElement => {
    const created = tools.appendChild(document.createElement("button"));
    created.type = "button";
    created.textContent = label;
    created.title = title;
    created.setAttribute("aria-label", title);
    created.addEventListener("click", run);
    return created;
  };
  tools.appendChild(document.createElement("span")).textContent = t("Timing");
  const earlier = button("−", t("Show the lyrics earlier"), () => changeOffset(pluginApi, -OFFSET_STEP_SECONDS));
  offsetOutput = tools.appendChild(document.createElement("output"));
  const later = button("+", t("Show the lyrics later"), () => changeOffset(pluginApi, OFFSET_STEP_SECONDS));
  const reset = button(t("Reset"), t("Remove the correction for this track"), () => changeOffset(pluginApi, "reset"));
  offsetButtons = [earlier, later, reset];
  tools.appendChild(document.createElement("span")).className = "ytmd-lyrics-spacer";
  const large = button(t("Large"), t("Fill the window with the lyrics"), () => {
    const on = container.parentElement?.classList.toggle(LARGE_CLASS) === true;
    large.textContent = on ? t("Small") : t("Large");
    // The lines have moved: scroll to the current one again.
    lineElements[activeIndex]?.classList.remove("ytmd-lyrics-active");
    activeIndex = -1;
  });
  showOffset();
}

const lyricsPlugin: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.ui.injectCss(CSS);
    api.ui.addNavButton(t("Lyrics"), toggle);
    applyShortcut();
  },

  onUIReady() {
    if (!api) return;
    panel = api.ui.addPanel(t("Lyrics"));
    // Trusted Types forbid innerHTML here: build elements by hand.
    buildTools(api, panel.body);
    body = panel.body.appendChild(document.createElement("div"));
    body.className = BODY_CLASS;

    applyFontSize();
    if (api.settings.get("openOnStart") === true) open();
    const song = api.music.getCurrentSong();
    if (song) void loadLyrics(api, song);
    else showStatus(t("Play a song to see its lyrics."));
    timer = setInterval(tick, POLL_MS);
  },

  onSongChange(song) {
    if (api && body) void loadLyrics(api, song);
  },

  onSettingsChange() {
    applyFontSize();
    applyShortcut();
  },

  onUnload() {
    clearInterval(timer);
    request++;
    // The API removes the button, the panel and the CSS.
    panel = body = offsetOutput = removeShortcut = undefined;
    offsetButtons = [];
    lyricsVideoId = null;
    offset = 0;
    lyrics = null;
    lineElements = [];
    activeIndex = -1;
    api = undefined;
  },
};

export default lyricsPlugin;

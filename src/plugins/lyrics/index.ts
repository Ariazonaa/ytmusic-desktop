// Lyrics: a side panel with time-synced lyrics from LRCLIB, falling back to
// plain lyrics from lyrics.ovh. The current line is highlighted and clicking a
// line jumps to it.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Panel, Plugin, PluginApi, Song } from "../../shared/types";
import { activeLineIndex, type Lyrics } from "./lrc";
import { OFFSET_STEP_SECONDS, describeOffset, parseOffsets, withOffset } from "./offsets";
import manifest from "./plugin.json";
import { findLyrics } from "./sources";
import { QuotaError, translateLines } from "./translate";
import { lyricsOverlay, lyricsOverlayLine } from "../../core/settings/client";
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
.${BODY_CLASS} .ytmd-lyrics-translation { display: block; font-size: 0.75em; font-weight: 400; opacity: 0.75; }
.${BODY_CLASS} p.ytmd-lyrics-note { font-size: 12px; color: rgba(255, 255, 255, 0.5); }
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
/** Translations by track and language, so that a track asks the service once. */
const translations = new Map<string, string[] | null>();
const MAX_TRANSLATIONS = 100;

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
    lineElements = (found.plain ?? "").split("\n").map((line) => {
      const text = document.createElement("p");
      text.className = "ytmd-lyrics-plain";
      text.textContent = line;
      return text;
    });
    body.replaceChildren(...lineElements);
  }
  body.scrollTop = 0;
}

/** The text of each shown line, in the order shown. */
function shownLines(found: Lyrics): string[] {
  return found.synced ? found.synced.map((line) => line.text) : (found.plain ?? "").split("\n");
}

/** Puts the translation of each line under it, as the setting asks. */
async function translate(pluginApi: PluginApi, found: Lyrics, current: number): Promise<void> {
  const target = pluginApi.settings.get("translateTo");
  if (typeof target !== "string" || target === "" || !lyricsVideoId) return;
  const key = `${lyricsVideoId}|${target}`;
  let lines = translations.get(key);
  if (lines === undefined) {
    try {
      lines = await translateLines((url) => pluginApi.net.getJson(url), shownLines(found), target);
    } catch (error) {
      if (current !== request) return;
      note(error instanceof QuotaError ? t("Translation: today's amount is used up.") : t("Translation failed."));
      return;
    }
    if (translations.size >= MAX_TRANSLATIONS) translations.delete(translations.keys().next().value as string);
    translations.set(key, lines);
  }
  if (current !== request || !lines) return;
  lines.forEach((line, index) => {
    const element = lineElements[index];
    if (!element || line === "") return;
    const translation = element.appendChild(document.createElement("span"));
    translation.className = "ytmd-lyrics-translation";
    translation.textContent = line;
  });
}

/** A small line above the lyrics, for what went wrong beside them. */
function note(text: string): void {
  if (!body) return;
  const line = document.createElement("p");
  line.className = "ytmd-lyrics-note";
  line.textContent = text;
  body.prepend(line);
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
    updateOverlay();
    if (found) {
      showLyrics(found.lyrics);
      panel?.setTitle(t("Lyrics"), found.source);
      void translate(pluginApi, found.lyrics, current);
    } else {
      showStatus(t("No lyrics found."));
    }
  } catch (error) {
    if (current !== request) return;
    console.warn("[lyrics] could not load lyrics", error);
    showStatus(t("Could not load lyrics."));
  }
}

const overlayOn = (): boolean => api?.settings.get("overlay") === true;
/** What the lyrics window shows now, so that it hears of changes only. */
let overlayShown = "";
/** Whether the window was last asked to be open. */
let overlayWanted = false;

/** Sends the line being sung and the next one to the lyrics window, if it is on. */
function updateOverlay(): void {
  if (!overlayOn()) return;
  const song = api?.music.getCurrentSong();
  const synced = lyrics?.synced;
  const [line, next] = synced
    ? [synced[activeIndex]?.text ?? "", synced[activeIndex + 1]?.text ?? ""]
    : [song?.title ?? "", song?.artist ?? ""];
  const key = JSON.stringify([line, next]);
  if (key === overlayShown) return;
  overlayShown = key;
  lyricsOverlayLine(line, next).catch(() => {});
}

/** Opens or closes the lyrics window as the setting says. */
function applyOverlay(): void {
  overlayShown = "";
  overlayWanted = overlayOn();
  lyricsOverlay(overlayOn()).catch(() => {});
  // The window needs a moment to listen.
  if (overlayOn()) setTimeout(updateOverlay, 1500);
}

/** Highlights the line being sung, keeps it in the middle of the panel and tells the lyrics window. */
function tick(): void {
  if (!api || !lyrics?.synced) return;
  if (!panel?.open && !overlayOn()) return;
  const position = api.music.getPlaybackState()?.positionSeconds;
  if (position === undefined) return;
  const index = activeLineIndex(lyrics.synced, position - offset);
  if (index === activeIndex) return;
  lineElements[activeIndex]?.classList.remove("ytmd-lyrics-active");
  activeIndex = index;
  updateOverlay();
  const line = lineElements[index];
  if (!line || !body || !panel?.open) return;
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
    applyOverlay();
  },

  onSongChange(song) {
    if (api && body) void loadLyrics(api, song);
  },

  onSettingsChange() {
    applyFontSize();
    applyShortcut();
    if (overlayOn() !== (overlayShown !== "" || overlayWanted)) {
      overlayWanted = overlayOn();
      applyOverlay();
    }
  },

  onUnload() {
    clearInterval(timer);
    if (overlayWanted) lyricsOverlay(false).catch(() => {});
    overlayWanted = false;
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

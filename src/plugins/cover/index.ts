// Cover: the playing track's cover, large in a panel or over the whole
// window, and saved as a picture.
import { parseManifest } from "../../core/plugin-manager/api";
import { saveCover } from "../../core/settings/client";
import { t } from "../../core/i18n";
import type { Panel, Plugin, PluginApi, Song } from "../../shared/types";
import { SettingShortcut } from "../setting-shortcut";
import { fallbackCover, largeCover } from "./size";
import manifest from "./plugin.json";

const CLASS = "ytmd-cover";

const CSS = `
.${CLASS} { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.${CLASS} img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 8px; background: rgba(255, 255, 255, 0.05); cursor: zoom-in; }
.${CLASS}-caption { color: rgba(255, 255, 255, 0.7); font-size: 13px; }
.${CLASS}-row { display: flex; gap: 8px; flex-wrap: wrap; }
.${CLASS}-row button {
  padding: 6px 10px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px;
  background: #1c1c1c; color: #fff; font: inherit; cursor: pointer;
}
.${CLASS}-row button:disabled { opacity: 0.4; cursor: default; }
.${CLASS}-message { margin: 0; color: rgba(255, 255, 255, 0.7); font-size: 13px; }
.${CLASS}-overlay {
  position: fixed; inset: 0; z-index: 10000; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  background: rgba(0, 0, 0, 0.92); cursor: zoom-out;
}
.${CLASS}-overlay img { max-width: 90vw; max-height: 82vh; object-fit: contain; border-radius: 8px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6); }
.${CLASS}-overlay p { margin: 0; color: #fff; font-size: 18px; text-align: center; }
`;

let api: PluginApi | undefined;
let song: Song | null = null;
let panel: Panel | undefined;
let image: HTMLImageElement | undefined;
let caption: HTMLElement | undefined;
let message: HTMLElement | undefined;
let saveButton: HTMLButtonElement | undefined;
let overlay: HTMLElement | undefined;

const coverUrl = (): string | null => (song?.artworkUrl ? largeCover(song.artworkUrl) : null);
const describe = (): string => (song ? `${song.artist} – ${song.title}` : "");

/** Shows `url` in `img`, and the smaller picture if a video has no large one. */
function showCover(img: HTMLImageElement, url: string): void {
  img.onerror = () => {
    const smaller = fallbackCover(img.src);
    if (smaller && img.src !== smaller) img.src = smaller;
  };
  if (img.src !== url) img.src = url;
}

function render(): void {
  const url = coverUrl();
  if (image && caption && saveButton) {
    image.hidden = url === null;
    if (url) showCover(image, url);
    caption.textContent = song ? describe() : t("No cover yet.");
    saveButton.disabled = url === null;
  }
  if (overlay) {
    const big = overlay.querySelector("img");
    if (big && url) showCover(big, url);
    const text = overlay.querySelector("p");
    if (text) text.textContent = describe();
  }
}

function closeOverlay(): void {
  overlay?.remove();
  overlay = undefined;
  document.removeEventListener("keydown", onOverlayKey, true);
}

function onOverlayKey(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  closeOverlay();
}

/** The cover over the whole window; a click or Escape takes it away. */
function toggleOverlay(): void {
  if (overlay) {
    closeOverlay();
    return;
  }
  if (!coverUrl()) return;
  overlay = document.body.appendChild(document.createElement("div"));
  overlay.className = `${CLASS}-overlay`;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", t("Cover"));
  overlay.appendChild(document.createElement("img")).alt = describe();
  overlay.appendChild(document.createElement("p"));
  overlay.addEventListener("click", closeOverlay);
  document.addEventListener("keydown", onOverlayKey, true);
  render();
}

function save(): void {
  const url = image?.currentSrc || image?.src;
  if (!url || !song || !message) return;
  const status = message;
  status.textContent = "";
  saveCover(url, describe()).then(
    (saved) => (status.textContent = saved ? t("Saved.") : ""),
    (reason: unknown) => (status.textContent = t("Could not save the cover: {reason}", { reason: String(reason) })),
  );
}

const shortcut = new SettingShortcut(toggleOverlay);

const cover: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    song = api.music.getCurrentSong();
    api.ui.injectCss(CSS);
    api.ui.addNavButton(t("Cover"), () => {
      if (panel?.open) panel.hide();
      else panel?.show();
    });
    shortcut.apply(api);
  },

  onUIReady() {
    if (!api) return;
    panel = api.ui.addPanel(t("Cover"));
    const body = panel.body.appendChild(document.createElement("div"));
    body.className = CLASS;
    image = body.appendChild(document.createElement("img"));
    image.alt = "";
    image.title = t("Show large");
    image.addEventListener("click", toggleOverlay);
    caption = body.appendChild(document.createElement("div"));
    caption.className = `${CLASS}-caption`;
    const row = body.appendChild(document.createElement("div"));
    row.className = `${CLASS}-row`;
    const large = row.appendChild(document.createElement("button"));
    large.type = "button";
    large.textContent = t("Show large");
    large.addEventListener("click", toggleOverlay);
    saveButton = row.appendChild(document.createElement("button"));
    saveButton.type = "button";
    saveButton.textContent = t("Save picture");
    saveButton.addEventListener("click", save);
    message = body.appendChild(document.createElement("p"));
    message.className = `${CLASS}-message`;
    message.setAttribute("role", "status");
    render();
  },

  onSongChange(next) {
    song = next;
    if (message) message.textContent = "";
    render();
  },

  onSettingsChange() {
    shortcut.apply(api);
  },

  onUnload() {
    // The API removes the button, the panel, the shortcut and the CSS.
    closeOverlay();
    shortcut.clear();
    api = panel = image = caption = message = saveButton = undefined;
    song = null;
  },
};

export default cover;

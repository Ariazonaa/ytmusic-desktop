// Demo plugin: proves the injection pipeline end to end and serves as a
// template. It tints the navigation bar, adds a button to it and logs songs.
import { parseManifest } from "../../core/plugin-manager/api";
import { SELECTORS } from "../../core/injector/dom";
import type { Plugin, PluginApi } from "../../shared/types";
import manifest from "./plugin.json";

const BUTTON_ID = "ytmd-demo-button";
const RED = "#e11d48";
const COLORS: Record<string, string> = { red: RED, blue: "#3b82f6", green: "#22c55e" };

const css = (color: string): string => `
ytmusic-nav-bar { box-shadow: inset 0 -2px 0 ${color}; }
#${BUTTON_ID} {
  margin: 0 8px;
  padding: 6px 12px;
  border: 1px solid ${color};
  border-radius: 16px;
  background: transparent;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
`;

let api: PluginApi | undefined;
let button: HTMLButtonElement | undefined;
let removeCss: (() => void) | undefined;

/** Brings CSS and button in line with the plugin's settings. */
function applySettings(): void {
  if (!api) return;
  removeCss?.();
  removeCss = api.ui.injectCss(css(COLORS[String(api.settings.get("accentColor"))] ?? RED));
  if (button) button.textContent = String(api.settings.get("buttonLabel"));
}

const demo: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    applySettings();
  },

  onUIReady() {
    const navBar = document.querySelector(SELECTORS.navBar);
    if (!navBar || !api) return;
    const music = api.music;
    // Trusted Types forbid innerHTML here: build elements by hand.
    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.addEventListener("click", () => {
      const song = music.getCurrentSong();
      console.info("[demo] current song:", song ?? "nothing playing", music.getPlaybackState());
    });
    (navBar.querySelector(".right-content") ?? navBar).prepend(button);
    applySettings();
  },

  onSettingsChange() {
    applySettings();
  },

  onSongChange(song) {
    if (api?.settings.get("logSongs") !== true) return;
    console.info(`[demo] now playing: ${song.artist} – ${song.title}`);
  },

  onPlaybackChange(state) {
    const duration = state.durationSeconds?.toFixed(0) ?? "?";
    const status = state.paused ? "paused" : "playing";
    console.info(`[demo] ${status} at ${state.positionSeconds.toFixed(0)}/${duration} s`);
  },

  onUnload() {
    button?.remove();
    button = undefined;
    removeCss = undefined;
    api = undefined;
  },
};

export default demo;

// Wheel volume: turning the mouse wheel over the player bar changes the volume.
import { SELECTORS } from "../../core/injector/dom";
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import manifest from "./plugin.json";
import { t } from "../../core/i18n";

let api: PluginApi | undefined;
let bar: Element | undefined;

function onWheel(event: Event): void {
  if (!api || !(event instanceof WheelEvent) || event.deltaY === 0) return;
  const current = api.player.getVolume();
  if (current === null) return;
  // Otherwise the page behind the bar would scroll.
  event.preventDefault();
  const step = api.settings.get("step");
  const delta = (typeof step === "number" ? step : 5) * (event.deltaY < 0 ? 1 : -1);
  const volume = api.player.setVolume(current + delta);
  if (volume !== null && api.settings.get("showNotice") === true) {
    api.ui.showNotice(t("Volume {volume} %", { volume }));
  }
}

const wheelVolume: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
  },

  onUIReady() {
    bar = document.querySelector(SELECTORS.playerBar) ?? undefined;
    // Not passive: the handler has to stop the page from scrolling.
    bar?.addEventListener("wheel", onWheel, { passive: false });
  },

  onUnload() {
    bar?.removeEventListener("wheel", onWheel);
    bar = api = undefined;
  },
};

export default wheelVolume;

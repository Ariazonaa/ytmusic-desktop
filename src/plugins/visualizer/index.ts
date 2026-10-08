// Visualizer: the spectrum of what is playing, as bars behind the player bar.
import { SELECTORS } from "../../core/injector/dom";
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import { barLevels } from "./bars";
import manifest from "./plugin.json";

/** Position in the audio chain: last, so the bars show what is heard. */
const ORDER = 95;
const BARS = 64;
const CANVAS_CLASS = "ytmd-visualizer";

const CSS = `
${SELECTORS.playerBar} { position: relative; }
.${CANVAS_CLASS} {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
/* The bar's own content stays above the canvas. */
${SELECTORS.playerBar} > :not(.${CANVAS_CLASS}) { position: relative; z-index: 1; }
`;

let api: PluginApi | undefined;
let analyser: AnalyserNode | undefined;
let spectrum: Uint8Array<ArrayBuffer> | undefined;
let canvas: HTMLCanvasElement | undefined;
let frame = 0;

function draw(): void {
  frame = requestAnimationFrame(draw);
  if (!canvas || !analyser || !spectrum || !api) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  // The canvas follows the size of the bar it lies in.
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.clearRect(0, 0, width, height);
  if (api.music.getPlaybackState()?.paused !== false) return;

  analyser.getByteFrequencyData(spectrum);
  const levels = barLevels(spectrum, analyser.context.sampleRate, BARS);
  const opacity = api.settings.get("opacity");
  context.globalAlpha = (typeof opacity === "number" ? opacity : 35) / 100;
  // The accent color of YouTube Music, which the themes plugin can change.
  context.fillStyle = getComputedStyle(canvas).getPropertyValue("--ytmusic-playback-progress-color").trim() || "#f03";
  const slot = width / BARS;
  for (const [index, level] of levels.entries()) {
    const barHeight = level * height;
    context.fillRect(index * slot + slot * 0.15, height - barHeight, slot * 0.7, barHeight);
  }
}

const visualizer: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.audio.addEffect(ORDER, (context) => {
      analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.75;
      spectrum = new Uint8Array(analyser.frequencyBinCount);
      // Sound passes through the analyser unchanged.
      return { input: analyser, output: analyser };
    });
    api.ui.injectCss(CSS);
  },

  onUIReady() {
    const bar = document.querySelector(SELECTORS.playerBar);
    if (!bar) return;
    canvas = document.createElement("canvas");
    canvas.className = CANVAS_CLASS;
    canvas.setAttribute("aria-hidden", "true");
    bar.prepend(canvas);
    // Runs only while the window is shown: the browser pauses these frames in the tray.
    frame = requestAnimationFrame(draw);
  },

  onUnload() {
    cancelAnimationFrame(frame);
    canvas?.remove();
    api = analyser = spectrum = canvas = undefined;
  },
};

export default visualizer;

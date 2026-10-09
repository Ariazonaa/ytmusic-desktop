import type { Plugin } from "../shared/types";
import adblock from "./adblock";
import audioOnly from "./audio-only";
import audioTools from "./audio-tools";
import compressor from "./compressor";
import crossfade from "./crossfade";
import demo from "./demo";
import equalizer from "./equalizer";
import headphones from "./headphones";
import limiter from "./limiter";
import lyrics from "./lyrics";
import normalize from "./normalize";
import playbackSpeed from "./playback-speed";
import preferOpus from "./prefer-opus";
import skipDisliked from "./skip-disliked";
import sponsorblock from "./sponsorblock";
import themes from "./themes";
import trackFade from "./track-fade";
import trackInfo from "./track-info";
import visualizer from "./visualizer";
import wheelVolume from "./wheel-volume";

/** Plugins compiled into the app. Which ones run is decided by `settings.json`. */
export const builtinPlugins: readonly Plugin[] = [
  adblock,
  audioOnly,
  audioTools,
  compressor,
  crossfade,
  demo,
  equalizer,
  headphones,
  limiter,
  lyrics,
  normalize,
  playbackSpeed,
  preferOpus,
  skipDisliked,
  sponsorblock,
  themes,
  trackFade,
  trackInfo,
  visualizer,
  wheelVolume,
];

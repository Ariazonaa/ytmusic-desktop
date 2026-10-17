import type { Plugin } from "../shared/types";
import adblock from "./adblock";
import audioOnly from "./audio-only";
import audioTools from "./audio-tools";
import compressor from "./compressor";
import cover from "./cover";
import crossfade from "./crossfade";
import demo from "./demo";
import discord from "./discord";
import equalizer from "./equalizer";
import headphones from "./headphones";
import keepPlaying from "./keep-playing";
import limiter from "./limiter";
import lyrics from "./lyrics";
import normalize from "./normalize";
import nowPlaying from "./now-playing";
import playbackSpeed from "./playback-speed";
import playlistTools from "./playlist-tools";
import preferOpus from "./prefer-opus";
import skipDisliked from "./skip-disliked";
import skipSilence from "./skip-silence";
import sponsorblock from "./sponsorblock";
import stats from "./stats";
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
  cover,
  crossfade,
  demo,
  discord,
  equalizer,
  headphones,
  keepPlaying,
  limiter,
  lyrics,
  normalize,
  nowPlaying,
  playbackSpeed,
  playlistTools,
  preferOpus,
  skipDisliked,
  skipSilence,
  sponsorblock,
  stats,
  themes,
  trackFade,
  trackInfo,
  visualizer,
  wheelVolume,
];

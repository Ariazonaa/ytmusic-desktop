// Crossfade: the end of a track plays over the start of the next.
//
// YouTube Music has one player, so the next track cannot be started early.
// Instead the current one is finished early, without the listener noticing:
//
//   1. The player runs a few percent fast, with pitch correction off.
//   2. Its sound goes through a delay line whose delay grows at the matching
//      pace, which slows the sound down again. The two cancel exactly (see
//      `plan.ts`), but the player gets ahead of what is heard.
//   3. When the player reaches the end, those last seconds are still in the
//      delay line. They play out and fade while the next track, which the
//      player has already started, fades in through a second delay line.
//
// What is heard is an ordinary crossfade. The cost: the player's position,
// and with it the picture of a music video, is ahead of the sound by up to
// the crossfade's length. Pausing and seeking drop what is in the delay line.
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import { correctDisplay } from "./display";
import { MIN_TAIL_SECONDS, fadeCurves, rateFor, slopeFor, tailSeconds, targetDelay } from "./plan";
import manifest from "./plugin.json";

/** Position in the audio chain: first, so every other effect works on what is heard. */
const ORDER = 1;
const POLL_MS = 50;
/** The longest delay a line can hold: the largest crossfade plus what its tail adds. */
const MAX_DELAY_SECONDS = 14;
/** How long a ramp of the delay is scheduled ahead. It is renewed long before it ends. */
const HORIZON_SECONDS = 30;
/** Seconds for switching gains without a click. */
const CLICK_FREE = 0.015;
/** A jump in the player's position larger than this counts as a seek. */
const SEEK_THRESHOLD_SECONDS = 1.2;
/** The slope is only re-planned if it would change by more than this. */
const SLOPE_TOLERANCE = 0.002;

/** One of the two delay lines. While a track plays, its sound runs through one of them. */
interface Line {
  input: GainNode;
  delay: DelayNode;
  output: GainNode;
  /** The delay is `anchorDelay` at `anchorTime` and grows by `slope` per second. */
  anchorTime: number;
  anchorDelay: number;
  slope: number;
}

interface Graph {
  context: AudioContext;
  lines: [Line, Line];
  master: GainNode;
}

let api: PluginApi | undefined;
let graph: Graph | undefined;
let active = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let stopCorrectingDisplay: (() => void) | undefined;
let lastVideoId: string | null = null;
let lastPosition = 0;
let lastTick = 0;
let wasPaused = true;
/** What was reported through `setOutputDelay`: how far the player is ahead, in track seconds. */
let reportedAhead = 0;
const CURVES = fadeCurves();

const delayAt = (line: Line, time: number): number =>
  Math.max(0, line.anchorDelay + line.slope * (time - line.anchorTime));

/** Makes the line's delay grow at `slope` from now on, continuing from its current value. */
function setSlope(line: Line, slope: number, time: number): void {
  const delay = Math.min(MAX_DELAY_SECONDS, delayAt(line, time));
  const horizon = slope > 0 ? Math.min(HORIZON_SECONDS, (MAX_DELAY_SECONDS - delay) / slope) : HORIZON_SECONDS;
  const param = line.delay.delayTime;
  param.cancelAndHoldAtTime(time);
  param.linearRampToValueAtTime(delay + slope * horizon, time + horizon);
  line.anchorTime = time;
  line.anchorDelay = delay;
  line.slope = slope;
}

/** Empties the line: what goes in comes out at once. */
function clearDelay(line: Line, time: number): void {
  line.delay.delayTime.cancelScheduledValues(time);
  line.delay.delayTime.setValueAtTime(0, time);
  line.anchorTime = time;
  line.anchorDelay = 0;
  line.slope = 0;
}

function setGain(node: GainNode, value: number, time: number): void {
  node.gain.cancelScheduledValues(time);
  node.gain.setTargetAtTime(value, time, CLICK_FREE / 3);
}

function setRate(rate: number): void {
  const video = document.querySelector("video");
  if (!video) return;
  if (Math.abs(video.playbackRate - rate) > 1e-4) video.playbackRate = rate;
  // Pitch correction would undo the trick: the delay line corrects the pitch.
  if (video.preservesPitch !== (rate === 1)) video.preservesPitch = rate === 1;
}

function report(aheadSeconds: number): void {
  reportedAhead = aheadSeconds;
  api?.audio.setOutputDelay(aheadSeconds);
}

/** Drops what is in the delay lines, so that the player's sound is heard directly. */
function reset(g: Graph, time: number, reason: string): void {
  console.debug(`[crossfade] reset: ${reason}`);
  const [current, other] = [g.lines[active], g.lines[1 - active]] as [Line, Line];
  clearDelay(current, time + CLICK_FREE);
  setGain(current.input, 1, time);
  setGain(current.output, 1, time);
  setGain(other.input, 0, time);
  setGain(other.output, 0, time);
  report(0);
}

/** The player moved on to another track: let the old one play out over the new one. */
function crossfade(g: Graph, time: number): void {
  const [old, next] = [g.lines[active], g.lines[1 - active]] as [Line, Line];
  active = 1 - active;
  const tail = tailSeconds(delayAt(old, time), old.slope);
  console.debug(`[crossfade] overlapping the tracks for ${tail.toFixed(2)} s`);

  setGain(old.input, 0, time);
  setGain(next.input, 1, time);
  clearDelay(next, time);
  // The old line keeps its slope: its contents were recorded at the fast rate.
  setSlope(old, old.slope, time);

  for (const node of [old.output, next.output]) node.gain.cancelScheduledValues(time);
  if (tail < MIN_TAIL_SECONDS) {
    setGain(old.output, 0, time);
    setGain(next.output, 1, time);
  } else {
    old.output.gain.setValueCurveAtTime(CURVES.out, time, tail);
    next.output.gain.setValueCurveAtTime(CURVES.in, time, tail);
  }
  report(0);
}

function tick(): void {
  if (!api || !graph) return;
  const g = graph;
  const playback = api.music.getPlaybackState();
  if (!playback) return;
  const videoId = api.music.getVideoId();
  const time = g.context.currentTime;
  const now = performance.now();
  // The reported position is what is heard. The player itself is further on.
  const position = playback.positionSeconds + reportedAhead;
  const line = g.lines[active] as Line;
  const rate = rateFor(line.slope);

  if (videoId !== lastVideoId) {
    if (lastVideoId !== null && !playback.paused) crossfade(g, time);
    else reset(g, time, "first track");
    lastVideoId = videoId;
  } else if (playback.paused) {
    if (!wasPaused) {
      // Stop at once, and take the player back to what was last heard:
      // otherwise the sound in the delay line would be skipped on resume.
      const ahead = rate * delayAt(line, time);
      setGain(g.master, 0, time);
      reset(g, time, "paused");
      if (ahead > 0.05) api.player.seekTo(Math.max(0, position - ahead));
    }
  } else if (wasPaused) {
    setGain(g.master, 1, time);
  } else {
    const expected = lastPosition + ((now - lastTick) / 1000) * rate;
    const jump = position - expected;
    if (Math.abs(jump) > SEEK_THRESHOLD_SECONDS) reset(g, time, `position jumped by ${jump.toFixed(1)} s`);
  }

  const current = g.lines[active] as Line;
  if (playback.paused) {
    setRate(1);
  } else {
    const setting = api.settings.get("seconds");
    const target = targetDelay(typeof setting === "number" ? setting : 0, playback.durationSeconds);
    const remaining = (playback.durationSeconds ?? 0) - position;
    const slope = slopeFor(target, delayAt(current, time), remaining);
    if (Math.abs(slope - current.slope) > SLOPE_TOLERANCE || (slope === 0) !== (current.slope === 0)) {
      setSlope(current, slope, time);
    } else if (time - current.anchorTime > HORIZON_SECONDS / 2) {
      setSlope(current, current.slope, time);
    }
    setRate(rateFor(current.slope));
    report(rateFor(current.slope) * delayAt(current, time));
  }

  lastPosition = playback.positionSeconds + reportedAhead;
  lastTick = now;
  wasPaused = playback.paused;
}

function build(context: AudioContext): { graph: Graph; input: GainNode } {
  const input = context.createGain();
  const master = context.createGain();
  const makeLine = (open: boolean): Line => {
    const line: Line = {
      input: context.createGain(),
      delay: context.createDelay(MAX_DELAY_SECONDS + 1),
      output: context.createGain(),
      anchorTime: context.currentTime,
      anchorDelay: 0,
      slope: 0,
    };
    line.input.gain.value = open ? 1 : 0;
    line.output.gain.value = open ? 1 : 0;
    input.connect(line.input).connect(line.delay).connect(line.output).connect(master);
    return line;
  };
  return { graph: { context, lines: [makeLine(true), makeLine(false)], master }, input };
}

const crossfadePlugin: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    active = 0;
    lastVideoId = null;
    wasPaused = true;
    reportedAhead = 0;
    api.audio.addEffect(ORDER, (context) => {
      const built = build(context);
      graph = built.graph;
      return { input: built.input, output: built.graph.master };
    });
    timer = setInterval(tick, POLL_MS);
    const music = api.music;
    stopCorrectingDisplay = correctDisplay(() => {
      const playback = music.getPlaybackState();
      return playback ? { position: playback.positionSeconds, ahead: reportedAhead } : null;
    });
  },

  onUnload() {
    clearInterval(timer);
    stopCorrectingDisplay?.();
    stopCorrectingDisplay = undefined;
    setRate(1);
    // The API removes the effect and reports that the player is no longer ahead.
    api = graph = undefined;
  },
};

export default crossfadePlugin;

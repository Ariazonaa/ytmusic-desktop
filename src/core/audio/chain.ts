import type { AudioEffect } from "../../shared/types";
import { waitForElement } from "../injector/dom";

type Build = (context: AudioContext) => AudioEffect;

interface Entry {
  order: number;
  build: Build;
  /** Built once the audio context exists. */
  effect?: AudioEffect;
}

type Logger = Pick<Console, "error">;

/**
 * The chain works at four times the usual sample rate. Effects that shift
 * the sound by fractions of a sample, like the crossfade's growing delay,
 * distort high tones, and far less so the more samples there are per wave:
 * measured at 10 kHz, the distortion fell from 19 dB to about 40 dB below
 * the tone. Other effects are not affected, beyond a little processor time.
 */
const SAMPLE_RATE = 192000;

function createHighRateContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: SAMPLE_RATE });
  } catch {
    // Not every audio device takes this rate. The default always works.
    return new AudioContext();
  }
}

/** Events that show a media element is, or is about to be, the one playing. */
const ACTIVITY = ["loadstart", "play", "playing"] as const;

/**
 * Routes the player's audio through the effects plugins add:
 *
 *     <video> → effect → effect → … → speakers
 *
 * A media element can feed only one Web Audio source, so all plugins share
 * this chain instead of each tapping the element. The audio is left untouched
 * until the first effect is added.
 *
 * YouTube Music sometimes replaces its `<video>` element, for instance when
 * seeking back from the end of a track. The chain follows: it taps whichever
 * element is playing. Staying on the old one would mean silence in the chain
 * and unprocessed sound from the new element.
 */
export class AudioChain {
  private context: AudioContext | undefined;
  private source: AudioNode | undefined;
  private element: HTMLMediaElement | undefined;
  /** An element can be tapped only once, so its source is kept for reuse. */
  private readonly sources = new WeakMap<HTMLMediaElement, AudioNode>();
  private entries: Entry[] = [];
  private waiting = false;
  private failed = false;

  constructor(
    private readonly doc: Document = document,
    private readonly createContext: () => AudioContext = createHighRateContext,
    private readonly log: Logger = console,
  ) {}

  /**
   * Adds an effect. Effects run in ascending `order`. Returns a function that
   * removes the effect again.
   */
  addEffect(order: number, build: Build): () => void {
    const entry: Entry = { order, build };
    this.entries.push(entry);
    // Array.prototype.sort is stable: effects with equal order keep their sequence.
    this.entries.sort((a, b) => a.order - b.order);
    this.connect();
    return () => {
      if (!this.entries.includes(entry)) return;
      this.disconnectAll();
      this.entries = this.entries.filter((other) => other !== entry);
      this.rewire();
    };
  }

  /** Taps the player once it exists, then wires up the effects. */
  private connect(): void {
    if (this.failed) return;
    if (!this.context) {
      const video = this.doc.querySelector("video");
      if (!video) {
        if (this.waiting) return;
        this.waiting = true;
        void waitForElement("video", this.doc).then(() => {
          this.waiting = false;
          if (this.entries.length > 0) this.connect();
        });
        return;
      }
      try {
        this.context = this.createContext();
      } catch (error) {
        this.fail(error);
        return;
      }
      for (const type of ACTIVITY) this.doc.addEventListener(type, this.onActivity, true);
      this.adopt(video);
      return;
    }
    this.rewire();
  }

  private readonly onActivity = (event: Event): void => {
    if (event.target instanceof HTMLVideoElement) this.adopt(event.target);
    // A context created before the user interacted starts suspended, which
    // would mute the player. Playback starting is the moment to wake it.
    void this.context?.resume();
  };

  /** Makes `element` the one whose sound runs through the effects. */
  private adopt(element: HTMLMediaElement): void {
    if (!this.context || this.failed || element === this.element) return;
    let source = this.sources.get(element);
    if (!source) {
      try {
        source = this.context.createMediaElementSource(element);
      } catch (error) {
        // Never tapped a single element: give up. Otherwise keep the old one.
        if (!this.source) this.fail(error);
        else this.log.error("[ytm-desktop] cannot process the new player's audio", error);
        return;
      }
      this.sources.set(element, source);
    }
    this.disconnectAll();
    this.source = source;
    this.element = element;
    this.rewire();
  }

  private fail(error: unknown): void {
    // From here on the element would be silent if we held on to a half-built graph.
    this.failed = true;
    this.context = this.source = this.element = undefined;
    this.log.error("[ytm-desktop] cannot process the player's audio", error);
  }

  private disconnectAll(): void {
    this.source?.disconnect();
    for (const entry of this.entries) entry.effect?.output.disconnect();
  }

  private rewire(): void {
    if (!this.context || !this.source) return;
    this.disconnectAll();
    let tail = this.source;
    for (const entry of this.entries) {
      entry.effect ??= entry.build(this.context);
      tail.connect(entry.effect.input);
      tail = entry.effect.output;
    }
    tail.connect(this.context.destination);
    void this.context.resume();
  }
}

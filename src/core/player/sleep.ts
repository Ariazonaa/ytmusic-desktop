// The sleep timer's "at the end of the track": pauses just before the playing
// track ends, before YouTube Music goes on to the next one. The timer itself
// runs in the backend (`sleep.rs`), which arms this and hears when it is done.

/**
 * Seconds before the end at which to pause. YouTube Music goes on to the next
 * track a little before the end its player reports, and the position comes
 * only about four times a second; what is cut is mostly the fade-out.
 */
const BEFORE_END = 1.5;
/** From here on, a track that starts is the next one. */
const NEAR_END = 6;
/** A track this far in has just started. */
const JUST_STARTED = 3;

export class SleepAtTrackEnd {
  private armed = false;
  /** The track was in its last seconds: should the next one start anyway, it is stopped at once. */
  private nearEnd = false;
  private readonly listener = (event: Event): void => {
    const video = event.target;
    if (!this.armed || !(video instanceof HTMLVideoElement)) return;
    const { duration, currentTime } = video;
    const known = Number.isFinite(duration) && duration > 0;
    if (event.type === "play" || event.type === "playing") {
      if (this.nearEnd && currentTime < JUST_STARTED) this.stop(video);
      return;
    }
    if (!known) return;
    if (duration - currentTime <= NEAR_END) this.nearEnd = true;
    if (event.type === "ended" || currentTime >= duration - BEFORE_END) this.stop(video);
  };

  constructor(
    private readonly done: () => void,
    doc: Document = document,
  ) {
    // Capturing, as media events do not bubble.
    for (const type of ["timeupdate", "ended", "play", "playing"]) doc.addEventListener(type, this.listener, true);
  }

  private stop(video: HTMLVideoElement): void {
    video.pause();
    this.set(false);
    this.done();
  }

  set(on: boolean): void {
    this.armed = on;
    this.nearEnd = false;
  }

  get isArmed(): boolean {
    return this.armed;
  }
}

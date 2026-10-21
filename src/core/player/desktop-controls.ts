// Keeps the player on the desktop's media controls under WebKitGTK (MPRIS on
// Linux: media keys, the panel's player). WebKitGTK offers only the media
// session that last began playback there and takes the others off. Besides its
// video, YouTube Music has a session of its own in a frame, which now and then
// begins playback a few milliseconds after the video, e.g. once the video plays
// after waiting for data; the player is then gone from the desktop until the
// video starts again. play() on the video that already plays makes it the last
// one to begin again, without a gap in the sound and without a `play` event.

/** After the video starts playing, how long until it takes its place back. */
const RECLAIM_AFTER_MS = 500;

/** Starts watching; returns a function that stops it. */
export function keepOnDesktopControls(doc: Document = document): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onPlaying = (event: Event): void => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!video.paused && !video.ended) video.play().catch(() => {});
    }, RECLAIM_AFTER_MS);
  };
  // Capturing, as media events do not bubble.
  doc.addEventListener("playing", onPlaying, true);
  return () => {
    doc.removeEventListener("playing", onPlaying, true);
    clearTimeout(timer);
  };
}

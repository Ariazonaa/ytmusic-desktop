/** YouTube Music selectors the core relies on, kept in one place because the site's DOM changes. */
export const SELECTORS = {
  navBar: "ytmusic-nav-bar",
  nextButton: "ytmusic-player-bar .next-button",
  previousButton: "ytmusic-player-bar .previous-button",
  playerBar: "ytmusic-player-bar",
  volumeSlider: "ytmusic-player-bar #volume-slider",
  compactVolumeSlider: "ytmusic-player-bar #expand-volume-slider",
  muteButton: "ytmusic-player-bar yt-icon-button.volume",
  timeInfo: "ytmusic-player-bar .time-info",
  progressBar: "ytmusic-player-bar #progress-bar",
} as const;

/**
 * Resolves with the first element matching `selector`, waiting for it to
 * appear. Works from document start, before `<html>` exists.
 */
export function waitForElement(selector: string, doc: Document = document): Promise<Element> {
  const existing = doc.querySelector(selector);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const element = doc.querySelector(selector);
      if (!element) return;
      observer.disconnect();
      resolve(element);
    });
    observer.observe(doc, { childList: true, subtree: true });
  });
}

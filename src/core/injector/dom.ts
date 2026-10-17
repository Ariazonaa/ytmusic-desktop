/**
 * YouTube Music selectors the core relies on, kept in one place because the
 * site's DOM changes. Each names the part in both player bars YouTube Music
 * shows: `ytmusic-player-bar` and the newer `ytmusic-miniplayer`, which some
 * page loads get instead.
 */
export const SELECTORS = {
  navBar: "ytmusic-nav-bar",
  nextButton: "ytmusic-player-bar .next-button, ytmusic-miniplayer .ytmusicPlayerControlsNextButton button",
  previousButton: "ytmusic-player-bar .previous-button, ytmusic-miniplayer .ytmusicPlayerControlsPreviousButton button",
  playerBar: "ytmusic-player-bar, ytmusic-miniplayer",
  volumeSlider: "ytmusic-player-bar #volume-slider, ytmusic-miniplayer input#slider",
  compactVolumeSlider: "ytmusic-player-bar #expand-volume-slider",
  muteButton: "ytmusic-player-bar yt-icon-button.volume, ytmusic-miniplayer .ytMusicMiniPlayerMuteButton button",
  timeInfo: "ytmusic-player-bar .time-info, ytmusic-miniplayer .ytMusicMiniPlayerTimeInfo",
  progressBar: "ytmusic-player-bar #progress-bar, ytmusic-miniplayer input.ytMusicMiniPlayerProgressBar",
  likeButtons: "ytmusic-player-bar ytmusic-like-button-renderer, ytmusic-miniplayer like-button-view-model",
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

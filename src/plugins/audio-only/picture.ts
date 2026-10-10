// What audio-only does when a music video has no audio version to switch to,
// which is the case for every music video without Premium: the picture is
// loaded in the smallest size there is and the cover is shown in its place.
//
// The sound is a stream of its own and stays as it is.

/** Shown in place of the picture, for as long as the player is in video mode. */
export const COVER_CSS = `
ytmusic-player[video-mode] #song-video { visibility: hidden !important; }
ytmusic-player[video-mode] #song-image { display: block !important; }
`;

/** The smallest picture the player offers, 144 lines. */
const SMALLEST = "tiny";
/** Where the player writes down the quality it was asked for, as the user's preference. */
const STORED_QUALITY = "yt-player-quality";

/** The part of YouTube's player this needs. */
export interface QualityPlayer {
  getAvailableQualityLevels?: () => string[];
  getPlaybackQuality?: () => string;
  setPlaybackQualityRange?: (min: string, max: string) => void;
}

/**
 * Asks for a quality without it becoming the user's preference: the player
 * stores what it is asked for, and would use it in every browser profile
 * session from then on, also with the plugin off. So what was stored before
 * is put back, at once and again after the player has had time to write.
 */
function ask(
  player: QualityPlayer,
  quality: string,
  storage: Storage,
  later: (run: () => void) => void,
  stillCurrent: () => boolean,
): void {
  const before = storage.getItem(STORED_QUALITY);
  const putBack = (): void => {
    if (before === null) storage.removeItem(STORED_QUALITY);
    else storage.setItem(STORED_QUALITY, before);
  };
  player.setPlaybackQualityRange?.(quality, quality);
  putBack();
  // Not after a newer request: that one has its own idea of what was there before.
  later(() => {
    if (stillCurrent()) putBack();
  });
}

export class SmallPicture {
  private lowered = false;
  /** Counts the requests, so that a late callback knows whether it is still the latest. */
  private requests = 0;

  private ask(player: QualityPlayer, quality: string): void {
    const request = ++this.requests;
    ask(player, quality, this.storage, this.later, () => request === this.requests);
  }

  constructor(
    private readonly storage: Storage = localStorage,
    private readonly later: (run: () => void) => void = (run) => setTimeout(run, 1500),
  ) {}

  /** Makes the picture as small as it gets. Does nothing if it already is, or cannot be. */
  lower(player: QualityPlayer | null): void {
    if (!player?.setPlaybackQualityRange) return;
    if (!player.getAvailableQualityLevels?.().includes(SMALLEST)) return;
    if (player.getPlaybackQuality?.() === SMALLEST) return;
    this.lowered = true;
    this.ask(player, SMALLEST);
  }

  /** Gives the choice of quality back to the player, if this took it. */
  restore(player: QualityPlayer | null): void {
    if (!this.lowered) return;
    this.lowered = false;
    if (player?.setPlaybackQualityRange) this.ask(player, "auto");
  }
}

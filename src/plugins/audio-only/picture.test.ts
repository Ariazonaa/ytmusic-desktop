import { afterEach, describe, expect, it, vi } from "vitest";
import { switchIsOff } from "./index";
import { SmallPicture, type QualityPlayer } from "./picture";

const KEY = "yt-player-quality";

/** A player that, like YouTube's, writes down what it is asked for. */
function fakePlayer(quality = "medium", levels = ["hd720", "medium", "tiny", "auto"]) {
  const state = { quality };
  const player: Required<QualityPlayer> = {
    getAvailableQualityLevels: () => levels,
    getPlaybackQuality: () => state.quality,
    setPlaybackQualityRange: vi.fn((min: string) => {
      state.quality = min;
      localStorage.setItem(KEY, `asked for ${min}`);
    }),
  };
  return { player, state };
}

afterEach(() => {
  localStorage.clear();
});

describe("SmallPicture", () => {
  it("asks for the smallest picture without leaving that as the user's preference", () => {
    const later: (() => void)[] = [];
    const picture = new SmallPicture(localStorage, (run) => later.push(run));
    const { player, state } = fakePlayer();

    picture.lower(player);
    expect(player.setPlaybackQualityRange).toHaveBeenCalledWith("tiny", "tiny");
    expect(state.quality).toBe("tiny");
    expect(localStorage.getItem(KEY)).toBeNull();

    // The player may write a moment later: that is undone as well.
    localStorage.setItem(KEY, "written late");
    later.forEach((run) => run());
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("lets only the latest request tidy up after itself", () => {
    const later: (() => void)[] = [];
    const picture = new SmallPicture(localStorage, (run) => later.push(run));
    const { player } = fakePlayer();
    picture.lower(player);
    picture.restore(player);
    const [afterLower, afterRestore] = later;
    // The callback of the first request is out of date: it leaves alone what is there now.
    localStorage.setItem(KEY, "there now");
    afterLower?.();
    expect(localStorage.getItem(KEY)).toBe("there now");
    afterRestore?.();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps a preference the user had", () => {
    localStorage.setItem(KEY, "the user's own");
    const picture = new SmallPicture(localStorage, () => {});
    picture.lower(fakePlayer().player);
    expect(localStorage.getItem(KEY)).toBe("the user's own");
  });

  it("does not ask again once the picture is small, and not where it cannot be", () => {
    const picture = new SmallPicture(localStorage, () => {});
    const small = fakePlayer("tiny");
    picture.lower(small.player);
    expect(small.player.setPlaybackQualityRange).not.toHaveBeenCalled();

    const none = fakePlayer("medium", ["medium", "auto"]);
    picture.lower(none.player);
    expect(none.player.setPlaybackQualityRange).not.toHaveBeenCalled();
    picture.lower(null);
    picture.lower({});
  });

  it("gives the choice back only if it took it", () => {
    const picture = new SmallPicture(localStorage, () => {});
    const { player } = fakePlayer();
    picture.restore(player);
    expect(player.setPlaybackQualityRange).not.toHaveBeenCalled();

    picture.lower(player);
    picture.restore(player);
    expect(player.setPlaybackQualityRange).toHaveBeenLastCalledWith("auto", "auto");
    expect(localStorage.getItem(KEY)).toBeNull();
    picture.restore(player);
    expect(player.setPlaybackQualityRange).toHaveBeenCalledTimes(2);
  });
});

describe("switchIsOff", () => {
  it("reads the switch as the page marks it", () => {
    const toggle = document.createElement("ytmusic-av-toggle");
    expect(switchIsOff(null)).toBe(false);
    expect(switchIsOff(toggle)).toBe(false);
    toggle.setAttribute("toggle-disabled", "");
    expect(switchIsOff(toggle)).toBe(true);
    toggle.setAttribute("toggle-disabled", "false");
    expect(switchIsOff(toggle)).toBe(false);
  });
});

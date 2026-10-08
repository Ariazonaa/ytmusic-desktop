import { afterEach, describe, expect, it, vi } from "vitest";
import { changeVolume, getVolume, setVolume, toggleMute } from "./volume";

function addPlayerBar(volume: number) {
  const bar = document.body.appendChild(document.createElement("ytmusic-player-bar"));
  const slider = Object.assign(bar.appendChild(document.createElement("div")), { id: "volume-slider", value: volume });
  const compact = Object.assign(bar.appendChild(document.createElement("div")), {
    id: "expand-volume-slider",
    value: volume,
  });
  const mute = bar.appendChild(document.createElement("yt-icon-button"));
  mute.className = "volume";
  const onChange = vi.fn();
  slider.addEventListener("change", onChange);
  return { slider, compact, mute, onChange };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("volume", () => {
  it("is null before the player bar exists, and nothing throws", () => {
    expect(getVolume()).toBeNull();
    expect(setVolume(50)).toBeNull();
    expect(changeVolume(10)).toBeNull();
    expect(() => toggleMute()).not.toThrow();
  });

  it("reads the slider", () => {
    addPlayerBar(44);
    expect(getVolume()).toBe(44);
  });

  it("moves both sliders and tells the page", () => {
    const { slider, compact, onChange } = addPlayerBar(44);
    expect(setVolume(60)).toBe(60);
    expect(slider.value).toBe(60);
    expect(compact.value).toBe(60);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("keeps the volume between 0 and 100, in whole steps", () => {
    addPlayerBar(50);
    expect(setVolume(150)).toBe(100);
    expect(setVolume(-5)).toBe(0);
    expect(setVolume(33.6)).toBe(34);
  });

  it("ignores invalid values", () => {
    const { onChange } = addPlayerBar(50);
    expect(setVolume(Number.NaN)).toBe(50);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("changes the volume relative to the current one", () => {
    addPlayerBar(95);
    expect(changeVolume(10)).toBe(100);
    expect(changeVolume(-30)).toBe(70);
  });

  it("mutes through the page's button", () => {
    const { mute } = addPlayerBar(50);
    const onClick = vi.fn();
    mute.addEventListener("click", onClick);
    toggleMute();
    expect(onClick).toHaveBeenCalledOnce();
  });

  /** A page whose mute button behaves like YouTube Music's: unmuting lands a step lower. */
  function addMutingPage(volume: number) {
    const bar = addPlayerBar(volume);
    const player = { volume: 16, muted: false };
    const element = Object.assign(document.body.appendChild(document.createElement("div")), {
      id: "movie_player",
      getVolume: () => player.volume,
    });
    let shown = volume;
    bar.slider.addEventListener("change", () => (shown = bar.slider.value));
    bar.mute.addEventListener("click", () => {
      player.muted = !player.muted;
      bar.slider.value = player.muted ? 0 : shown - 1;
    });
    return { ...bar, player, element };
  }

  it("brings back the exact volume when unmuting", () => {
    const { slider, player } = addMutingPage(44);
    toggleMute();
    expect(slider.value).toBe(0);
    expect(player.muted).toBe(true);
    toggleMute();
    expect(player.muted).toBe(false);
    expect(slider.value).toBe(44);
  });

  it("leaves the volume alone when it was changed while muted", () => {
    const { slider, player } = addMutingPage(44);
    toggleMute();
    // Someone drags the page's slider: the player's volume changes with it.
    player.volume = 60;
    toggleMute();
    expect(slider.value).toBe(43);
  });

  it("forgets the remembered volume once it was used", () => {
    const { slider, mute } = addMutingPage(44);
    toggleMute();
    toggleMute();
    // Muted with the page's own button this time, so nothing is remembered.
    mute.click();
    toggleMute();
    expect(slider.value).toBe(43);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { controlPlayer } from "./controls";
import { changeVolume, getVolume, setVolume, setVolumeStep, toggleMute } from "./volume";

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
  setVolumeStep(null);
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

  it("moves by 10 for the tray and shortcuts, or by the step asked for", () => {
    addPlayerBar(50);
    controlPlayer("volumeUp");
    expect(getVolume()).toBe(60);
    setVolumeStep(2);
    controlPlayer("volumeUp");
    expect(getVolume()).toBe(62);
    controlPlayer("volumeDown");
    expect(getVolume()).toBe(60);
    setVolumeStep(null);
    controlPlayer("volumeDown");
    expect(getVolume()).toBe(50);
  });

  it("ignores a step that makes no sense", () => {
    addPlayerBar(50);
    setVolumeStep(0);
    controlPlayer("volumeUp");
    expect(getVolume()).toBe(60);
    setVolumeStep(Number.NaN);
    controlPlayer("volumeUp");
    expect(getVolume()).toBe(70);
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

describe("the newer player bar", () => {
  it("moves its range input and tells the page as the input does", () => {
    const bar = document.body.appendChild(document.createElement("ytmusic-miniplayer"));
    const slider = bar.appendChild(document.createElement("input"));
    Object.assign(slider, { type: "range", id: "slider", min: "0", max: "100", value: "44" });
    const events: string[] = [];
    slider.addEventListener("input", () => events.push("input"));
    slider.addEventListener("change", () => events.push("change"));
    expect(getVolume()).toBe(44);
    expect(setVolume(60)).toBe(60);
    expect(slider.value).toBe("60");
    expect(events).toEqual(["input", "change"]);
  });

  it("leaves unmuting to the page: its slider shows another scale than it sets", () => {
    const bar = document.body.appendChild(document.createElement("ytmusic-miniplayer"));
    const slider = bar.appendChild(document.createElement("input"));
    Object.assign(slider, { type: "range", id: "slider", min: "0", max: "100", value: "73" });
    const wrapper = bar.appendChild(document.createElement("div"));
    wrapper.className = "ytMusicMiniPlayerMuteButton";
    const button = wrapper.appendChild(document.createElement("button"));
    const player = { volume: 44, muted: false };
    Object.assign(document.body.appendChild(document.createElement("div")), { id: "movie_player", getVolume: () => player.volume });
    button.addEventListener("click", () => {
      player.muted = !player.muted;
      slider.value = player.muted ? "0" : "64";
    });
    const set = vi.fn();
    slider.addEventListener("input", set);
    toggleMute();
    expect(player.muted).toBe(true);
    toggleMute();
    expect(player.muted).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});

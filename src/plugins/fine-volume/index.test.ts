import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginApi, PluginSettingValues } from "../../shared/types";
import fineVolume, { levelFor, wheelDelta } from "./index";

describe("levelFor", () => {
  it("is full volume at 100 and silence at 0", () => {
    expect(levelFor(100, 50)).toBe(1);
    expect(levelFor(0, 50)).toBe(0);
  });

  it("goes down in even steps of decibels", () => {
    const dB = (slider: number, range: number): number => 20 * Math.log10(levelFor(slider, range));
    expect(dB(50, 50)).toBeCloseTo(-25);
    expect(dB(1, 50)).toBeCloseTo(-49.5);
    expect(dB(2, 50) - dB(1, 50)).toBeCloseTo(0.5);
    expect(dB(1, 60)).toBeCloseTo(-59.4);
    expect(dB(90, 40)).toBeCloseTo(-4);
  });

  it("stays within 0 and 1 for anything", () => {
    expect(levelFor(150, 50)).toBe(1);
    expect(levelFor(-5, 50)).toBe(0);
    expect(levelFor(Number.NaN, 50)).toBe(0);
    expect(levelFor(50, Number.NaN)).toBeCloseTo(levelFor(50, 50));
  });
});

describe("wheelDelta", () => {
  const wheel = (deltaY: number, shiftKey = false, deltaX = 0) => new WheelEvent("wheel", { deltaY, deltaX, shiftKey });

  it("moves by the step, up when the wheel turns away", () => {
    expect(wheelDelta(wheel(-100), 3)).toBe(3);
    expect(wheelDelta(wheel(100), 3)).toBe(-3);
  });

  it("moves by 1 with Shift, also where Shift turns the wheel sideways", () => {
    expect(wheelDelta(wheel(-100, true), 5)).toBe(1);
    expect(wheelDelta(wheel(0, true, 100), 5)).toBe(-1);
  });

  it("does nothing without a turn", () => {
    expect(wheelDelta(wheel(0), 5)).toBe(0);
  });
});

describe("fine-volume", () => {
  let slider: HTMLElement & { value: number };
  let setVolumeLevel: ReturnType<typeof vi.fn>;
  let settings: PluginSettingValues;
  let api: PluginApi;
  let saved: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '<ytmusic-player-bar><div id="right"><div id="volume-slider"></div></div></ytmusic-player-bar>';
    slider = Object.assign(document.querySelector<HTMLElement>("#volume-slider")!, { value: 40 });
    setVolumeLevel = vi.fn();
    settings = { range: 50, step: 2, volume: -1 };
    saved = vi.fn(() => Promise.resolve());
    api = {
      player: {
        getVolume: () => slider.value,
        setVolume: (percent: number) => {
          slider.value = Math.min(100, Math.max(0, percent));
          slider.dispatchEvent(new CustomEvent("change", { bubbles: true }));
          return slider.value;
        },
      },
      audio: { setVolumeLevel },
      settings: { get: (key: string) => settings[key], getAll: () => settings, update: saved },
      ui: { injectCss: vi.fn(() => vi.fn()) },
    } as unknown as PluginApi;
    fineVolume.onLoad?.(api);
    fineVolume.onUIReady?.();
  });

  afterEach(() => {
    fineVolume.onUnload?.();
    document.body.replaceChildren();
  });

  const lastLevel = (): number => setVolumeLevel.mock.calls.at(-1)![0] as number;
  const own = (): HTMLInputElement => document.querySelector("[data-fine-volume] input")!;

  it("plays at the level of the slider's position", () => {
    expect(lastLevel()).toBeCloseTo(levelFor(40, 50));
  });

  it("follows the slider", () => {
    slider.value = 3;
    slider.dispatchEvent(new CustomEvent("change", { bubbles: true }));
    expect(lastLevel()).toBeCloseTo(levelFor(3, 50));
  });

  it("follows the player's volume changing, e.g. after mute", () => {
    document.body.append(document.createElement("video"));
    slider.value = 0;
    document.querySelector("video")!.dispatchEvent(new Event("volumechange"));
    expect(lastLevel()).toBe(0);
  });

  it("takes a new range at once", () => {
    settings.range = 60;
    fineVolume.onSettingsChange?.(settings);
    expect(lastLevel()).toBeCloseTo(levelFor(40, 60));
  });

  it("changes the volume with the mouse wheel over the player bar", () => {
    const bar = document.querySelector("ytmusic-player-bar")!;
    const turn = new WheelEvent("wheel", { deltaY: -100, cancelable: true, bubbles: true });
    bar.dispatchEvent(turn);
    expect(slider.value).toBe(42);
    expect(turn.defaultPrevented).toBe(true);
    bar.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, shiftKey: true, bubbles: true }));
    expect(slider.value).toBe(41);
    expect(lastLevel()).toBeCloseTo(levelFor(41, 50));
  });

  it("shows a slider of its own with the volume, and keeps it up to date", () => {
    const label = () => document.querySelector("[data-fine-volume]")?.textContent;
    expect(label()).toBe("40 %");
    expect(own().value).toBe("40");
    slider.value = 7;
    slider.dispatchEvent(new CustomEvent("change", { bubbles: true }));
    expect(label()).toBe("7 %");
    expect(own().value).toBe("7");
    expect(own().style.getPropertyValue("--fine-volume-fill")).toBe("7%");
  });

  it("sets the volume from its slider while it is dragged", () => {
    own().value = "12";
    own().dispatchEvent(new Event("input", { bubbles: true }));
    expect(slider.value).toBe(12);
    expect(lastLevel()).toBeCloseTo(levelFor(12, 50));
    expect(own().value).toBe("12");
    expect(document.querySelector("[data-fine-volume]")?.textContent).toBe("12 %");
  });

  it("sits before the volume button in the newer player bar", () => {
    fineVolume.onUnload?.();
    document.body.innerHTML =
      '<ytmusic-miniplayer><div class="ytMusicMiniPlayerRightSection"><div class="ytMusicMiniPlayerVolumeWrapper">' +
      '<div class="ytMusicMiniPlayerVolumePopup"><slider-shape><input id="slider" type="range"></slider-shape></div>' +
      "</div></div></ytmusic-miniplayer>";
    fineVolume.onLoad?.(api);
    fineVolume.onUIReady?.();
    const wrapper = document.querySelector(".ytMusicMiniPlayerVolumeWrapper")!;
    expect(wrapper.previousElementSibling).toBe(document.querySelector("[data-fine-volume]"));
  });

  it("puts its slider back when the page rebuilds the bar, as for an ad", () => {
    const control = document.querySelector("[data-fine-volume]")!;
    control.remove();
    document.body.append(document.createElement("video"));
    document.querySelector("video")!.dispatchEvent(new Event("timeupdate"));
    expect(document.querySelector("[data-fine-volume]")).toBe(control);
  });

  describe("keeping its own value", () => {
    // The newer bar shows a volume of 0.44 at 73, so the page's slider says
    // something else after a restart than what was set.
    const restart = (volume: number, page: number): void => {
      fineVolume.onUnload?.();
      settings.volume = volume;
      slider.value = page;
      fineVolume.onLoad?.(api);
      fineVolume.onUIReady?.();
    };

    it("goes back to its value at the start, not to what the page shows", () => {
      restart(44, 73);
      expect(slider.value).toBe(44);
      expect(lastLevel()).toBeCloseTo(levelFor(44, 50));
      expect(own().value).toBe("44");
      expect(setVolumeLevel.mock.calls.some(([level]) => (level as number) > levelFor(44, 50) + 0.001)).toBe(false);
    });

    it("takes the page's value on the first start", () => {
      restart(-1, 73);
      expect(slider.value).toBe(73);
      expect(lastLevel()).toBeCloseTo(levelFor(73, 50));
    });

    it("counts on from its value when the page shows another", () => {
      own().value = "44";
      own().dispatchEvent(new Event("input", { bubbles: true }));
      slider.value = 89;
      document.querySelector("ytmusic-player-bar")!.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
      expect(slider.value).toBe(46);
    });

    it("keeps its value when a setting changes", () => {
      own().value = "44";
      own().dispatchEvent(new Event("input", { bubbles: true }));
      slider.value = 89;
      settings.range = 60;
      fineVolume.onSettingsChange?.(settings);
      expect(lastLevel()).toBeCloseTo(levelFor(44, 60));
    });

    it("saves a change once it has settled", () => {
      vi.useFakeTimers();
      try {
        own().value = "30";
        own().dispatchEvent(new Event("input", { bubbles: true }));
        own().value = "31";
        own().dispatchEvent(new Event("input", { bubbles: true }));
        expect(saved).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2000);
        expect(saved).toHaveBeenCalledExactlyOnceWith({ volume: 31 });
      } finally {
        vi.useRealTimers();
      }
    });

    it("saves a change from the tray or a shortcut too", () => {
      vi.useFakeTimers();
      try {
        slider.value = 25;
        slider.dispatchEvent(new CustomEvent("change", { bubbles: true }));
        vi.advanceTimersByTime(2000);
        expect(saved).toHaveBeenCalledExactlyOnceWith({ volume: 25 });
      } finally {
        vi.useRealTimers();
      }
    });

    it("takes muting for no new position, though the older bar's slider goes to 0", () => {
      vi.useFakeTimers();
      try {
        const video = document.body.appendChild(document.createElement("video"));
        video.muted = true;
        slider.value = 0;
        video.dispatchEvent(new Event("volumechange"));
        vi.advanceTimersByTime(2000);
        expect(own().value).toBe("40");
        expect(saved).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("goes back to its position after unmuting, which the page rounds", () => {
      vi.useFakeTimers();
      try {
        const video = document.body.appendChild(document.createElement("video"));
        video.muted = true;
        slider.value = 0;
        video.dispatchEvent(new Event("volumechange"));
        video.muted = false;
        slider.value = 38;
        video.dispatchEvent(new Event("volumechange"));
        slider.dispatchEvent(new CustomEvent("change", { bubbles: true }));
        expect(own().value).toBe("40");
        vi.advanceTimersByTime(2000);
        expect(own().value).toBe("40");
        expect(slider.value).toBe(40);
        expect(saved).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("saves what is pending when switched off", () => {
      own().value = "33";
      own().dispatchEvent(new Event("input", { bubbles: true }));
      fineVolume.onUnload?.();
      expect(saved).toHaveBeenCalledExactlyOnceWith({ volume: 33 });
    });
  });

  it("leaves the page as it was when switched off", () => {
    fineVolume.onUnload?.();
    expect(document.querySelector("[data-fine-volume]")).toBeNull();
    const calls = setVolumeLevel.mock.calls.length;
    slider.value = 10;
    slider.dispatchEvent(new CustomEvent("change", { bubbles: true }));
    document.querySelector("ytmusic-player-bar")!.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    expect(setVolumeLevel.mock.calls.length).toBe(calls);
    expect(slider.value).toBe(10);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginApi } from "../../shared/types";
import preferOpus, { isAac } from "./index";

describe("isAac", () => {
  it("matches AAC audio only", () => {
    expect(isAac('audio/mp4; codecs="mp4a.40.2"')).toBe(true);
    expect(isAac("AUDIO/MP4")).toBe(true);
    expect(isAac('audio/webm; codecs="opus"')).toBe(false);
    expect(isAac('video/mp4; codecs="avc1.4d401e"')).toBe(false);
    expect(isAac("audio/mp4a-latm")).toBe(false);
  });
});

describe("prefer-opus", () => {
  const browserAnswer = vi.fn((_type: string) => true);
  const api = {} as PluginApi;

  beforeEach(() => {
    // jsdom has no MediaSource.
    vi.stubGlobal("MediaSource", { isTypeSupported: browserAnswer });
  });
  afterEach(() => {
    preferOpus.onUnload?.();
    vi.unstubAllGlobals();
    browserAnswer.mockClear();
  });

  it("reports AAC as unsupported and leaves other answers to the browser", () => {
    preferOpus.onLoad?.(api);
    expect(MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"')).toBe(false);
    expect(MediaSource.isTypeSupported('audio/webm; codecs="opus"')).toBe(true);
    expect(MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d401e"')).toBe(true);
    expect(browserAnswer).toHaveBeenCalledTimes(2);
  });

  it("does not claim support the browser lacks", () => {
    browserAnswer.mockReturnValueOnce(false);
    preferOpus.onLoad?.(api);
    expect(MediaSource.isTypeSupported('audio/webm; codecs="opus"')).toBe(false);
  });

  it("restores the browser's function on unload, also after loading twice", () => {
    preferOpus.onLoad?.(api);
    preferOpus.onLoad?.(api);
    preferOpus.onUnload?.();
    expect(MediaSource.isTypeSupported).toBe(browserAnswer);
  });
});

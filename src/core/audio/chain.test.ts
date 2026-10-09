import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioEffect } from "../../shared/types";
import { AudioChain } from "./chain";

/** A stand-in for an AudioNode that records what it is connected to. */
class FakeNode {
  targets: FakeNode[] = [];
  constructor(readonly name: string) {}
  connect(target: FakeNode): void {
    this.targets.push(target);
  }
  disconnect(): void {
    this.targets = [];
  }
}

const addVideo = (): HTMLVideoElement => document.body.appendChild(document.createElement("video"));

function setup(withVideo = true) {
  if (withVideo) addVideo();
  const sources: FakeNode[] = [];
  const destination = new FakeNode("destination");
  const context = {
    destination,
    createMediaElementSource: vi.fn((_element: HTMLMediaElement) => {
      const source = new FakeNode(`source${sources.length + 1}`);
      sources.push(source);
      return source;
    }),
    resume: vi.fn(() => Promise.resolve()),
  };
  const createContext = vi.fn(() => context as unknown as AudioContext);
  const log = { error: vi.fn() };
  const chain = new AudioChain(document, createContext, log);

  const effect = (name: string) => {
    const node = new FakeNode(name);
    const build = vi.fn((): AudioEffect => ({ input: node, output: node }) as unknown as AudioEffect);
    return { node, build };
  };
  /** Follows the connections from a source and lists the nodes passed. */
  const path = (from: FakeNode | undefined = sources.at(-1)): string[] => {
    const names: string[] = [];
    let node = from;
    while (node) {
      names.push(node.name);
      expect(node.targets.length).toBeLessThanOrEqual(1);
      node = node.targets[0];
    }
    return names;
  };
  return { chain, context, createContext, effect, path, log, sources };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("AudioChain", () => {
  it("leaves the audio alone until an effect is added", () => {
    const { createContext } = setup();
    expect(createContext).not.toHaveBeenCalled();
  });

  it("routes the player through the effects in ascending order", () => {
    const { chain, effect, path, context } = setup();
    chain.addEffect(20, effect("compressor").build);
    chain.addEffect(10, effect("equalizer").build);
    expect(path()).toEqual(["source1", "equalizer", "compressor", "destination"]);
    expect(context.createMediaElementSource).toHaveBeenCalledOnce();
  });

  it("builds each effect once and reconnects the rest when one is removed", () => {
    const { chain, effect, path } = setup();
    const equalizer = effect("equalizer");
    const compressor = effect("compressor");
    const removeEqualizer = chain.addEffect(10, equalizer.build);
    chain.addEffect(20, compressor.build);

    removeEqualizer();
    removeEqualizer();

    expect(path()).toEqual(["source1", "compressor", "destination"]);
    expect(equalizer.node.targets).toEqual([]);
    expect(compressor.build).toHaveBeenCalledOnce();
  });

  it("connects the player straight to the speakers when the last effect is removed", () => {
    const { chain, effect, path } = setup();
    chain.addEffect(10, effect("equalizer").build)();
    expect(path()).toEqual(["source1", "destination"]);
  });

  it("waits for the player to appear", async () => {
    const { chain, effect, path, createContext } = setup(false);
    chain.addEffect(10, effect("equalizer").build);
    chain.addEffect(20, effect("compressor").build);
    expect(createContext).not.toHaveBeenCalled();

    addVideo();
    await vi.waitFor(() => expect(createContext).toHaveBeenCalledOnce());
    expect(path()).toEqual(["source1", "equalizer", "compressor", "destination"]);
  });

  it("wakes a suspended context when playback starts", () => {
    const { chain, effect, context } = setup();
    chain.addEffect(10, effect("equalizer").build);
    context.resume.mockClear();
    document.querySelector("video")?.dispatchEvent(new Event("play"));
    expect(context.resume).toHaveBeenCalledOnce();
  });

  it("follows the page to a replacement video element", () => {
    const { chain, effect, path, context, sources } = setup();
    const equalizer = effect("equalizer");
    chain.addEffect(10, equalizer.build);
    const first = document.querySelector("video");

    first?.remove();
    const replacement = addVideo();
    replacement.dispatchEvent(new Event("loadstart"));

    expect(context.createMediaElementSource).toHaveBeenLastCalledWith(replacement);
    expect(path(sources[1])).toEqual(["source2", "equalizer", "destination"]);
    // The abandoned element must not keep feeding the effects.
    expect(sources[0]?.targets).toEqual([]);
    expect(equalizer.build).toHaveBeenCalledOnce();
  });

  it("taps each element only once, also when the page switches back", () => {
    const { chain, effect, path, context, sources } = setup();
    chain.addEffect(10, effect("equalizer").build);
    const first = document.querySelector("video");
    const second = addVideo();

    second.dispatchEvent(new Event("play"));
    second.dispatchEvent(new Event("playing"));
    first?.dispatchEvent(new Event("play"));

    expect(context.createMediaElementSource).toHaveBeenCalledTimes(2);
    expect(path(sources[0])).toEqual(["source1", "equalizer", "destination"]);
    expect(sources[1]?.targets).toEqual([]);
  });

  it("ignores activity of elements that are not videos", () => {
    const { chain, effect, context } = setup();
    chain.addEffect(10, effect("equalizer").build);
    document.body.appendChild(document.createElement("audio")).dispatchEvent(new Event("play"));
    expect(context.createMediaElementSource).toHaveBeenCalledOnce();
  });

  it("keeps the current player if a replacement cannot be tapped", () => {
    const { chain, effect, path, context, sources, log } = setup();
    chain.addEffect(10, effect("equalizer").build);
    context.createMediaElementSource.mockImplementationOnce(() => {
      throw new Error("no");
    });

    addVideo().dispatchEvent(new Event("play"));

    expect(log.error).toHaveBeenCalledOnce();
    expect(path(sources[0])).toEqual(["source1", "equalizer", "destination"]);
  });

  it("gives up without breaking anything if the player cannot be tapped", () => {
    const { chain, effect, context, createContext, log } = setup();
    context.createMediaElementSource.mockImplementation(() => {
      throw new Error("already connected");
    });
    const equalizer = effect("equalizer");

    const remove = chain.addEffect(10, equalizer.build);
    chain.addEffect(20, effect("compressor").build);

    expect(log.error).toHaveBeenCalledOnce();
    expect(createContext).toHaveBeenCalledOnce();
    expect(equalizer.build).not.toHaveBeenCalled();
    expect(remove).not.toThrow();
  });

  it("leaves out an effect that cannot be built and keeps the sound", () => {
    const { chain, effect, path, log } = setup();
    const good = effect("good");
    chain.addEffect(10, good.build);
    const broken = vi.fn((): AudioEffect => {
      throw new Error("no such node");
    });
    expect(() => chain.addEffect(5, broken)).not.toThrow();
    expect(path()).toEqual(["source1", "good", "destination"]);
    expect(log.error).toHaveBeenCalledOnce();

    // It is gone for good: later changes do not run into it again.
    const late = effect("late");
    chain.addEffect(20, late.build);
    expect(path()).toEqual(["source1", "good", "late", "destination"]);
    expect(broken).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanel } from "./panel";

// jsdom has no constructable stylesheets, and the styles do not matter here.
const noCss = vi.fn();
const make = (title: string) => createPanel(title, document, noCss);
const elements = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("aside")];

afterEach(() => {
  for (const element of elements()) element.remove();
});

describe("createPanel", () => {
  it("starts hidden, with its title", () => {
    const panel = make("Lyrics");
    expect(panel.open).toBe(false);
    expect(elements()[0]?.hidden).toBe(true);
    expect(elements()[0]?.querySelector("header span")?.textContent).toBe("Lyrics");
    expect(elements()[0]?.getAttribute("aria-label")).toBe("Lyrics");
  });

  it("shows and hides without calling the close handler", () => {
    const panel = make("Lyrics");
    const onClose = vi.fn();
    panel.onClose(onClose);

    panel.show();
    expect(panel.open).toBe(true);
    panel.hide();
    expect(panel.open).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("tells the owner when the user closes it", () => {
    const panel = make("Lyrics");
    const onClose = vi.fn();
    panel.onClose(onClose);
    panel.show();

    elements()[0]?.querySelector("button")?.click();

    expect(panel.open).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps only one panel open and tells the owner of the one it closes", () => {
    const lyrics = make("Lyrics");
    const history = make("History");
    const lyricsClosed = vi.fn();
    const historyClosed = vi.fn();
    lyrics.onClose(lyricsClosed);
    history.onClose(historyClosed);

    lyrics.show();
    history.show();
    expect(lyrics.open).toBe(false);
    expect(history.open).toBe(true);
    expect(lyricsClosed).toHaveBeenCalledOnce();

    lyrics.show();
    expect(history.open).toBe(false);
    expect(historyClosed).toHaveBeenCalledOnce();
    expect(lyricsClosed).toHaveBeenCalledOnce();
  });

  it("does not close itself when shown twice, nor a panel hidden in between", () => {
    const lyrics = make("Lyrics");
    const history = make("History");
    const lyricsClosed = vi.fn();
    lyrics.onClose(lyricsClosed);

    lyrics.show();
    lyrics.show();
    lyrics.hide();
    history.show();

    expect(lyricsClosed).not.toHaveBeenCalled();
  });

  it("updates title and subtitle", () => {
    const panel = make("Lyrics");
    panel.setTitle("Lyrics", "LRCLIB");
    expect(elements()[0]?.querySelector("header span")?.textContent).toBe("LyricsLRCLIB");
    expect(elements()[0]?.querySelector("header small")?.textContent).toBe("LRCLIB");
    panel.setTitle("Lyrics");
    expect(elements()[0]?.querySelector("header small")?.textContent).toBe("");
  });

  it("keeps its body element in place, so an iframe inside is not reloaded", () => {
    const panel = make("History");
    const frame = panel.body.appendChild(document.createElement("iframe"));
    const parent = frame.parentElement;
    panel.show();
    panel.hide();
    panel.show();
    expect(frame.parentElement).toBe(parent);
    expect(frame.isConnected).toBe(true);
  });

  it("can be removed, after which another panel opens without notifying it", () => {
    const lyrics = make("Lyrics");
    const history = make("History");
    const lyricsClosed = vi.fn();
    lyrics.onClose(lyricsClosed);
    lyrics.show();

    lyrics.remove();
    history.show();

    expect(elements()).toHaveLength(1);
    expect(lyricsClosed).not.toHaveBeenCalled();
  });
});

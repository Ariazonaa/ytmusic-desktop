import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import keepPlaying, { answerQuestion, markActive } from "./index";

type Page = Window & { _lact?: unknown };

/** The question as the page shows it. jsdom lays nothing out, so being on screen is stubbed. */
function question(onScreen: boolean): { element: HTMLElement; clicked: ReturnType<typeof vi.fn> } {
  const dialog = document.createElement("tp-yt-paper-dialog");
  const element = document.createElement("ytmusic-you-there-renderer");
  const button = document.createElement("button");
  const clicked = vi.fn();
  button.addEventListener("click", clicked);
  element.append(button);
  dialog.append(element);
  document.body.append(dialog);
  element.getClientRects = () => (onScreen ? [{}] : []) as unknown as DOMRectList;
  return { element, clicked };
}

describe("keep-playing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    keepPlaying.onUnload?.();
    vi.useRealTimers();
    document.body.replaceChildren();
    delete (window as Page)._lact;
  });

  it("tells the page there was input, only where the page keeps track of it", () => {
    const page = { _lact: 5 } as unknown as Page;
    markActive(page, 1000);
    expect(page._lact).toBe(1000);

    const other = {} as Page;
    markActive(other, 1000);
    expect("_lact" in other).toBe(false);
  });

  it("presses the button of the question that is on screen", () => {
    expect(answerQuestion()).toBe(false);
    const closed = question(false);
    expect(answerQuestion()).toBe(false);
    const open = question(true);
    expect(answerQuestion()).toBe(true);
    expect(open.clicked).toHaveBeenCalledOnce();
    expect(closed.clicked).not.toHaveBeenCalled();
  });

  it("leaves a question alone that the page has closed", () => {
    const { element, clicked } = question(true);
    element.parentElement?.setAttribute("aria-hidden", "true");
    expect(answerQuestion()).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });

  it("keeps the time of the last input fresh while it is on, and answers the question", () => {
    (window as Page)._lact = 0;
    vi.setSystemTime(100_000);
    keepPlaying.onLoad?.(undefined as never);
    expect((window as Page)._lact).toBe(100_000);

    const { clicked } = question(true);
    vi.advanceTimersByTime(20_000);
    expect((window as Page)._lact).toBe(120_000);
    expect(clicked).toHaveBeenCalledOnce();

    keepPlaying.onUnload?.();
    vi.advanceTimersByTime(60_000);
    expect((window as Page)._lact).toBe(120_000);
    expect(clicked).toHaveBeenCalledOnce();
  });
});

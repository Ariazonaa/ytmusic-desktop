import { afterEach, describe, expect, it, vi } from "vitest";
import { HealthReporter, checkPage } from "./health";

/** A page with everything the app looks for. */
function buildPage(): { player: Record<string, unknown> } {
  const navBar = document.body.appendChild(document.createElement("ytmusic-nav-bar"));
  void navBar;
  const bar = document.body.appendChild(document.createElement("ytmusic-player-bar"));
  const add = (tag: string, attributes: Record<string, string>): void => {
    const element = bar.appendChild(document.createElement(tag));
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  };
  add("div", { class: "next-button" });
  add("div", { class: "previous-button" });
  add("div", { id: "volume-slider" });
  add("yt-icon-button", { class: "volume" });
  add("span", { class: "time-info" });
  add("div", { id: "progress-bar" });
  add("ytmusic-like-button-renderer", {});
  const player = Object.assign(document.body.appendChild(document.createElement("div")), {
    id: "movie_player",
    getCurrentTime: () => 0,
    getVideoData: () => ({}),
    getPlayerResponse: () => ({}),
    seekTo: () => {},
  });
  return { player: player as unknown as Record<string, unknown> };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("checkPage", () => {
  it("finds nothing wrong with a complete page", () => {
    buildPage();
    expect(checkPage()).toEqual([]);
  });

  it("names the parts that are gone", () => {
    const { player } = buildPage();
    document.querySelector("#volume-slider")?.remove();
    document.querySelector("ytmusic-like-button-renderer")?.remove();
    player.seekTo = undefined;
    expect(checkPage()).toEqual(["volumeSlider", "likeButtons", "player.seekTo"]);
  });

  it("names the player when it is missing altogether", () => {
    buildPage();
    document.querySelector("#movie_player")?.remove();
    expect(checkPage()).toEqual(["player"]);
  });
});

describe("HealthReporter", () => {
  it("sends one report for a burst of changes", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => Promise.resolve());
    const reporter = new HealthReporter(send);
    reporter.setPageProblems(["volumeSlider"]);
    reporter.addPluginError("lyrics", "failed in onSongChange: boom");
    reporter.addPluginError("lyrics", "again");
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(send).toHaveBeenCalledExactlyOnceWith({
      pageProblems: ["volumeSlider"],
      pluginErrors: { lyrics: ["failed in onSongChange: boom", "again"] },
    });
  });

  it("keeps the newest errors of a plugin and forgets them on request", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => Promise.resolve());
    const reporter = new HealthReporter(send);
    for (let i = 0; i < 8; i++) reporter.addPluginError("demo", `error ${i}`);
    expect(reporter.current.pluginErrors.demo).toEqual(["error 3", "error 4", "error 5", "error 6", "error 7"]);
    await vi.advanceTimersByTimeAsync(600);
    reporter.clearPlugin("demo");
    reporter.clearPlugin("demo");
    await vi.advanceTimersByTimeAsync(600);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ pageProblems: [], pluginErrors: {} });
  });

  it("survives a report that cannot be sent", async () => {
    vi.useFakeTimers();
    const reporter = new HealthReporter(() => Promise.reject(new Error("no backend")));
    reporter.setPageProblems(["player"]);
    await vi.advanceTimersByTimeAsync(600);
    expect(reporter.current.pageProblems).toEqual(["player"]);
  });
});

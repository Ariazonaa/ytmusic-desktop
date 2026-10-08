import { afterEach, describe, expect, it, vi } from "vitest";
import type { Song } from "../../shared/types";
import { SongWatcher, songFromMetadata } from "./song";

const first: Song = { title: "One", artist: "A", album: "X", artworkUrl: null };
const second: Song = { title: "Two", artist: "A", album: "X", artworkUrl: null };

describe("songFromMetadata", () => {
  it("returns null without metadata or title", () => {
    expect(songFromMetadata(null)).toBeNull();
    expect(songFromMetadata({ title: "", artist: "", album: "", artwork: [] })).toBeNull();
  });

  it("picks the largest artwork", () => {
    const song = songFromMetadata({
      title: "One",
      artist: "A",
      album: "X",
      artwork: [{ src: "small.jpg" }, { src: "large.jpg" }],
    });
    expect(song).toEqual({ ...first, artworkUrl: "large.jpg" });
  });
});

describe("SongWatcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function watch(sequence: (Song | null)[]) {
    const onChange = vi.fn();
    let index = 0;
    const read = (): Song | null => sequence[Math.min(index++, sequence.length - 1)] ?? null;
    return { watcher: new SongWatcher(read, onChange), onChange };
  }

  it("reports each song exactly once", () => {
    const { watcher, onChange } = watch([null, first, { ...first }, first, second, second]);
    for (let i = 0; i < 6; i++) watcher.poll();
    expect(onChange.mock.calls).toEqual([[first], [second]]);
    expect(watcher.current).toEqual(second);
  });

  it("ignores artwork-only updates of the same song", () => {
    const { watcher, onChange } = watch([first, { ...first, artworkUrl: "late.jpg" }]);
    watcher.poll();
    watcher.poll();
    expect(onChange).toHaveBeenCalledOnce();
    expect(watcher.current?.artworkUrl).toBe("late.jpg");
  });

  it("reports a song again after playback was cleared", () => {
    const { watcher, onChange } = watch([first, null, first]);
    for (let i = 0; i < 3; i++) watcher.poll();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("polls on an interval until stopped", () => {
    vi.useFakeTimers();
    const { watcher, onChange } = watch([first, second]);
    watcher.start(1000);
    vi.advanceTimersByTime(2000);
    watcher.stop();
    vi.advanceTimersByTime(5000);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

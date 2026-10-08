import { afterEach, describe, expect, it, vi } from "vitest";
import { addToQueue, moveInQueue, readQueue, removeFromQueue } from "./queue";

function addItem(queue: Element, title: string, artist: string, videoId: unknown, selected = false) {
  const item = Object.assign(queue.appendChild(document.createElement("ytmusic-player-queue-item")), { data: { videoId } });
  if (selected) item.setAttribute("selected", "");
  for (const [className, text] of [["song-title", title], ["byline", artist], ["duration", "3:04"]] as const) {
    const part = item.appendChild(document.createElement("span"));
    part.className = className;
    part.textContent = ` ${text}\n`;
  }
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("readQueue", () => {
  it("is empty before a queue exists", () => {
    expect(readQueue()).toEqual([]);
  });

  it("lists the tracks in order and marks the playing one", () => {
    const queue = document.body.appendChild(document.createElement("ytmusic-player-queue"));
    addItem(queue, "First", "A", "aaaaaaaaaaa");
    addItem(queue, "Second", "B", "bbbbbbbbbbb", true);
    addItem(queue, "Third", "C", 5);
    expect(readQueue()).toEqual([
      { title: "First", artist: "A", duration: "3:04", videoId: "aaaaaaaaaaa", playing: false },
      { title: "Second", artist: "B", duration: "3:04", videoId: "bbbbbbbbbbb", playing: true },
      { title: "Third", artist: "C", duration: "3:04", videoId: null, playing: false },
    ]);
  });

  it("leaves out the hidden other version of a track", () => {
    const queue = document.body.appendChild(document.createElement("ytmusic-player-queue"));
    const wrapper = queue.appendChild(document.createElement("div"));
    addItem(wrapper.appendChild(document.createElement("div")), "Song", "A", "song-id-0001", true);
    const counterpart = wrapper.appendChild(document.createElement("div"));
    counterpart.hidden = true;
    addItem(counterpart, "Song (Video)", "A", "video-id-001");
    addItem(queue, "Other", "B", "other-id-001");
    expect(readQueue().map((item) => item.videoId)).toEqual(["song-id-0001", "other-id-001"]);
  });

  it("stops at a bounded number of tracks", () => {
    const queue = document.body.appendChild(document.createElement("ytmusic-player-queue"));
    for (let i = 0; i < 250; i++) addItem(queue, `Track ${i}`, "A", null);
    expect(readQueue()).toHaveLength(200);
  });
});

describe("addToQueue", () => {
  /** A page with the internals the queue is changed through. */
  function buildPage(state: Record<string, unknown>, queueDatas: unknown[] = [{ content: { renderer: "new" } }]) {
    const dispatch = vi.fn();
    const fetch = vi.fn((_path: string, _body: unknown) => Promise.resolve({ queueDatas }));
    Object.assign(document.body.appendChild(document.createElement("ytmusic-player-queue")), {
      dispatch,
      queue: { store: { store: { getState: () => ({ queue: state }) } } },
    });
    Object.assign(document.body.appendChild(document.createElement("ytmusic-app")), { networkManager: { fetch } });
    return { dispatch, fetch };
  }
  const state = { items: ["a", "b", "c", "d"], nextQueueItemId: 4, queueContextParams: "ctx", selectedItemIndex: 1 };

  it("puts a track right after the playing one", async () => {
    const { dispatch, fetch } = buildPage(state);
    await addToQueue("dQw4w9WgXcQ", "next");
    expect(fetch).toHaveBeenCalledWith("/music/get_queue", {
      queueContextParams: "ctx",
      queueInsertPosition: "INSERT_AFTER_CURRENT_VIDEO",
      videoIds: ["dQw4w9WgXcQ"],
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_ITEMS",
      payload: { nextQueueItemId: 4, index: 2, items: [{ renderer: "new" }], shuffleEnabled: false, shouldAssignIds: true },
    });
  });

  it("puts a track behind everything queued", async () => {
    const { dispatch } = buildPage(state);
    await addToQueue("dQw4w9WgXcQ", "end");
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ payload: { index: 4 } });
  });

  it("rejects without changing anything when the track is unknown", async () => {
    const { dispatch, fetch } = buildPage(state, []);
    await expect(addToQueue("dQw4w9WgXcQ", "next")).rejects.toThrow("does not know this track");
    // The page itself rejects for some ids, with an object instead of an error.
    fetch.mockRejectedValueOnce({ code: 400 });
    await expect(addToQueue("aaaaaaaaaaa", "next")).rejects.toThrow("does not know this track");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects bad arguments before asking anyone", async () => {
    const { fetch } = buildPage(state);
    await expect(addToQueue("x&list=evil", "next")).rejects.toThrow("not a video id");
    await expect(addToQueue("dQw4w9WgXcQ", "first" as "next")).rejects.toThrow("position");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects before there is a queue, and when the page's internals have changed", async () => {
    await expect(addToQueue("dQw4w9WgXcQ", "next")).rejects.toThrow("no play queue yet");
    document.body.appendChild(document.createElement("ytmusic-player-queue"));
    document.body.appendChild(document.createElement("ytmusic-app"));
    await expect(addToQueue("dQw4w9WgXcQ", "next")).rejects.toThrow("no play queue yet");
  });
});

describe("changing upcoming tracks", () => {
  function buildPage(state: Record<string, unknown>) {
    const dispatch = vi.fn();
    Object.assign(document.body.appendChild(document.createElement("ytmusic-player-queue")), {
      dispatch,
      queue: { store: { store: { getState: () => ({ queue: state }) } } },
    });
    Object.assign(document.body.appendChild(document.createElement("ytmusic-app")), { networkManager: { fetch: vi.fn() } });
    return dispatch;
  }
  // Positions 0 and 1 were played, 2 is playing, 3 to 5 come next.
  const state = { items: ["a", "b", "c", "d", "e", "f"], selectedItemIndex: 2 };

  it("removes an upcoming track", () => {
    const dispatch = buildPage(state);
    removeFromQueue(4);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "REMOVE_ITEM", payload: 4 });
  });

  it("moves an upcoming track among the upcoming ones", () => {
    const dispatch = buildPage(state);
    moveInQueue(5, 3);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "MOVE_ITEM", payload: { fromIndex: 5, toIndex: 3 } });
    moveInQueue(4, 4);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("leaves the playing track and the played ones alone", () => {
    const dispatch = buildPage(state);
    expect(() => removeFromQueue(2)).toThrow("only tracks after the playing one");
    expect(() => removeFromQueue(0)).toThrow("only tracks after the playing one");
    expect(() => moveInQueue(4, 2)).toThrow("only tracks after the playing one");
    expect(() => moveInQueue(1, 4)).toThrow("only tracks after the playing one");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("refuses positions that do not exist", () => {
    const dispatch = buildPage(state);
    for (const index of [6, -1, 3.5, Number.NaN]) expect(() => removeFromQueue(index), String(index)).toThrow("no track at this position");
    expect(() => moveInQueue(3, 6)).toThrow("no track at this position");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fails before there is a queue", () => {
    expect(() => removeFromQueue(3)).toThrow("no play queue yet");
    expect(() => moveInQueue(3, 4)).toThrow("no play queue yet");
  });
});

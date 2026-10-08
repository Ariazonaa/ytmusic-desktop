import { afterEach, describe, expect, it, vi } from "vitest";
import { Notifier, loadImage } from "./notify";

const COVER = "https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadImage", () => {
  it("loads a cover without cookies and gives it in base64", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadImage(COVER)).toBe("/9j/AA==");
    expect(fetchMock).toHaveBeenCalledWith(COVER, { credentials: "omit", referrerPolicy: "no-referrer" });
  });

  it("does not even ask for addresses that are not covers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const url of ["https://example.com/a.jpg", "http://i.ytimg.com/a.jpg", "file:///C:/secret.png", undefined, 5]) {
      expect(await loadImage(url), String(url)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives nothing for a failed, empty or large download", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    expect(await loadImage(COVER)).toBeNull();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("gone", { status: 404 })));
    expect(await loadImage(COVER)).toBeNull();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(new Uint8Array(0))));
    expect(await loadImage(COVER)).toBeNull();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(new Uint8Array(1024 * 1024 + 1))));
    expect(await loadImage(COVER)).toBeNull();
  });
});

describe("Notifier", () => {
  it("sends a plain notification", async () => {
    const send = vi.fn(() => Promise.resolve());
    await new Notifier(send).show("Title", "Body");
    expect(send).toHaveBeenCalledWith("Title", "Body", null, null);
  });

  it("runs the click handler once, for its own notification", async () => {
    const send = vi.fn((..._args: unknown[]) => Promise.resolve());
    const notifier = new Notifier(send);
    const first = vi.fn();
    const second = vi.fn();
    await notifier.show("One", "", { onClick: first });
    await notifier.show("Two", "", { onClick: second });
    const [firstId, secondId] = send.mock.calls.map((call) => call[3] as number);
    expect(firstId).not.toBe(secondId);

    notifier.clicked(secondId as number);
    notifier.clicked(secondId as number);
    notifier.clicked(999);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it("forgets the handler of a notification that was refused", async () => {
    const send = vi.fn((..._args: unknown[]) => Promise.reject(new Error("too many notifications")));
    const notifier = new Notifier(send);
    const onClick = vi.fn();
    await expect(notifier.show("One", "", { onClick })).rejects.toThrow("too many");
    notifier.clicked(send.mock.calls[0]?.[3] as number);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("only waits for clicks on the newest notifications", async () => {
    const send = vi.fn((..._args: unknown[]) => Promise.resolve());
    const notifier = new Notifier(send);
    const handlers = Array.from({ length: 25 }, () => vi.fn());
    for (const onClick of handlers) await notifier.show("N", "", { onClick });
    const ids = send.mock.calls.map((call) => call[3] as number);
    for (const id of ids) notifier.clicked(id);
    expect(handlers.filter((handler) => handler.mock.calls.length === 1)).toHaveLength(20);
    expect(handlers[0]).not.toHaveBeenCalled();
    expect(handlers[24]).toHaveBeenCalledOnce();
  });

  it("sends the picture along", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))));
    const send = vi.fn(() => Promise.resolve());
    await new Notifier(send).show("Title", "Body", { imageUrl: COVER });
    expect(send).toHaveBeenCalledWith("Title", "Body", "/9j/AA==", null);
  });
});

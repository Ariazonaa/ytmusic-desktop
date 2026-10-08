import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputDeviceWatcher } from "./output-device";

afterEach(() => {
  vi.useRealTimers();
});

describe("OutputDeviceWatcher", () => {
  it("asks once for the current device", async () => {
    const ask = vi.fn(() => Promise.resolve("Speakers"));
    const watcher = new OutputDeviceWatcher(ask, new EventTarget());
    expect(await watcher.current()).toBe("Speakers");
    expect(await watcher.current()).toBe("Speakers");
    expect(ask).toHaveBeenCalledOnce();
  });

  it("tells listeners when the sound goes to another device, once per change", async () => {
    vi.useFakeTimers();
    const devices = new EventTarget();
    let name: string | null = "Speakers";
    const watcher = new OutputDeviceWatcher(() => Promise.resolve(name), devices);
    const listener = vi.fn();
    const stop = watcher.onChange(listener);
    await watcher.current();

    name = "Headphones";
    // Plugging in raises a burst of events.
    for (let i = 0; i < 4; i++) devices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenCalledExactlyOnceWith("Headphones");

    // The list of devices changed, but not the one in use.
    devices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenCalledOnce();

    stop();
    name = null;
    devices.dispatchEvent(new Event("devicechange"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).toHaveBeenCalledOnce();
    expect(await watcher.current()).toBeNull();
  });

  it("counts a backend that cannot say as an unknown device", async () => {
    const watcher = new OutputDeviceWatcher(() => Promise.reject(new Error("no backend")), new EventTarget());
    expect(await watcher.current()).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputSwitch, blockMicrophone, deviceIdFor, labelMatches, type DeviceInfo } from "./output-switch";

const DEVICES: DeviceInfo[] = [
  { kind: "audiooutput", label: "Standard - Kopfhörer (MOMENTUM 4) (Bluetooth)", deviceId: "default" },
  { kind: "audiooutput", label: "Kommunikation - Kopfhörer (MOMENTUM 4) (Bluetooth)", deviceId: "communications" },
  { kind: "audiooutput", label: "Kopfhörer (MOMENTUM 4) (Bluetooth)", deviceId: "a7c2" },
  { kind: "audiooutput", label: "Kopfhörer (MOMENTUM 4 Hands-Free) (Bluetooth)", deviceId: "b1f0" },
  { kind: "audiooutput", label: "Lautsprecher (Focusrite USB Audio)", deviceId: "6a40" },
  { kind: "audioinput", label: "Mikrofon (Focusrite USB Audio)", deviceId: "9e11" },
];

afterEach(() => {
  document.body.replaceChildren();
});

describe("deviceIdFor", () => {
  it("finds a device by the name Windows gives it", () => {
    expect(deviceIdFor(DEVICES, "Lautsprecher (Focusrite USB Audio)")).toBe("6a40");
    expect(deviceIdFor(DEVICES, "Kopfhörer (MOMENTUM 4)")).toBe("a7c2");
    expect(deviceIdFor(DEVICES, "Kopfhörer (MOMENTUM 4 Hands-Free)")).toBe("b1f0");
  });

  it("gives the default for no name, and nothing for a device that is not there", () => {
    expect(deviceIdFor(DEVICES, "")).toBe("");
    expect(deviceIdFor(DEVICES, "Kopfhörer (MOMENTUM")).toBeNull();
    expect(deviceIdFor(DEVICES, "Mikrofon (Focusrite USB Audio)")).toBeNull();
    expect(deviceIdFor([], "Lautsprecher (Focusrite USB Audio)")).toBeNull();
  });

  it("matches the whole name only", () => {
    expect(labelMatches("Speakers (USB) (Bluetooth)", "Speakers (USB)")).toBe(true);
    expect(labelMatches("Speakers (USB) 2", "Speakers (USB)")).toBe(false);
  });
});

function setup(tapped: boolean) {
  const chain = { tapped, setSink: vi.fn(() => Promise.resolve()) };
  const listeners: Array<() => void> = [];
  const devices = {
    enumerateDevices: vi.fn(() => Promise.resolve(DEVICES as MediaDeviceInfo[])),
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.push(listener)),
  };
  const video = document.body.appendChild(document.createElement("video")) as HTMLVideoElement & {
    sinkId: string;
    setSinkId: ReturnType<typeof vi.fn>;
  };
  video.sinkId = "";
  video.setSinkId = vi.fn((id: string) => {
    video.sinkId = id;
    return Promise.resolve();
  });
  const log = { error: vi.fn() };
  const output = new OutputSwitch(chain, document, devices as unknown as MediaDevices, log);
  return { chain, devices, video, log, output, changed: () => listeners.forEach((listener) => listener()) };
}

describe("OutputSwitch", () => {
  it("sends the sound of the chain there, not the element's, once the chain has it", async () => {
    const { chain, video, output } = setup(true);
    await output.set("Lautsprecher (Focusrite USB Audio)");
    expect(chain.setSink).toHaveBeenCalledWith("6a40");
    expect(video.setSinkId).not.toHaveBeenCalled();
  });

  it("sends the element's sound there while no chain has it, and back to the default", async () => {
    const { video, output } = setup(false);
    await output.set("Lautsprecher (Focusrite USB Audio)");
    expect(video.sinkId).toBe("6a40");
    await output.set("");
    expect(video.sinkId).toBe("");
  });

  it("leaves the sound where it is for a device that is not there, and says so", async () => {
    const { chain, log, output } = setup(false);
    await output.set("Kopfhörer (Gone)");
    expect(chain.setSink).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it("looks again when the devices change", async () => {
    const { devices, output, changed } = setup(false);
    await output.set("Lautsprecher (Focusrite USB Audio)");
    changed();
    await Promise.resolve();
    expect(devices.enumerateDevices).toHaveBeenCalledTimes(2);
  });
});

describe("blockMicrophone", () => {
  it("refuses the microphone to the page", async () => {
    const real = vi.fn(() => Promise.resolve({}));
    const devices = Object.create({ getUserMedia: real }) as MediaDevices;
    const navigator = { mediaDevices: devices, webkitGetUserMedia: real };
    blockMicrophone({ navigator } as unknown as Window);
    await expect(devices.getUserMedia({ audio: true })).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(real).not.toHaveBeenCalled();
    expect(() => {
      (devices as unknown as { getUserMedia: unknown }).getUserMedia = real;
    }).toThrow();
  });
});

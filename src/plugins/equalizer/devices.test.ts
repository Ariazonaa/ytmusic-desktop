import { describe, expect, it } from "vitest";
import { MAX_DEVICES, parseDevicePresets, withDevicePreset } from "./devices";

describe("parseDevicePresets", () => {
  it("reads the preset chosen with each device", () => {
    const text = JSON.stringify({ "Headphones (WH-1000XM4)": "user:Sony", Speakers: "flat" });
    expect([...parseDevicePresets(text)]).toEqual([
      ["Headphones (WH-1000XM4)", "user:Sony"],
      ["Speakers", "flat"],
    ]);
  });

  it("drops what is not a choice", () => {
    const text = JSON.stringify({ "": "flat", Speakers: 5, Headphones: "", Long: "x".repeat(41), ["y".repeat(121)]: "flat", Ok: "rock" });
    expect([...parseDevicePresets(text)]).toEqual([["Ok", "rock"]]);
  });

  it("starts empty for a missing or damaged setting", () => {
    for (const setting of [undefined, "", "{ nope", "[]", "null", 5]) expect(parseDevicePresets(setting).size).toBe(0);
  });
});

describe("withDevicePreset", () => {
  it("sets and changes a device's preset", () => {
    const one = withDevicePreset(new Map(), "Speakers", "flat");
    expect(one).toBe('{"Speakers":"flat"}');
    expect(withDevicePreset(parseDevicePresets(one), "Speakers", "rock")).toBe('{"Speakers":"rock"}');
  });

  it("forgets the devices used longest ago", () => {
    let text = "{}";
    for (let i = 0; i < MAX_DEVICES + 3; i++) text = withDevicePreset(parseDevicePresets(text), `Device ${i}`, "flat");
    const choices = parseDevicePresets(text);
    expect(choices.size).toBe(MAX_DEVICES);
    expect(choices.has("Device 0")).toBe(false);
    expect(choices.has("Device 3")).toBe(true);
  });
});

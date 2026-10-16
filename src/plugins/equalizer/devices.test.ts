import { describe, expect, it } from "vitest";
import { MAX_DEVICES, parseDevicePresets, sameChoice, withDevicePreset } from "./devices";

const curve = [3, 2, 1, 0, -1, -2, -3, 0, 1.5, 6];

describe("parseDevicePresets", () => {
  it("reads the preset chosen with each device", () => {
    const text = JSON.stringify({ "Headphones (WH-1000XM4)": "user:Sony", Speakers: "flat" });
    expect([...parseDevicePresets(text)]).toEqual([
      ["Headphones (WH-1000XM4)", { preset: "user:Sony" }],
      ["Speakers", { preset: "flat" }],
    ]);
  });

  it("reads the bands of the own curve", () => {
    const text = JSON.stringify({ Headphones: { preset: "custom", bands: curve } });
    expect(parseDevicePresets(text).get("Headphones")).toEqual({ preset: "custom", bands: curve });
  });

  it("drops what is not a choice", () => {
    const text = JSON.stringify({
      "": "flat",
      Speakers: 5,
      Headphones: "",
      Long: "x".repeat(41),
      ["y".repeat(121)]: "flat",
      Short: { preset: "custom", bands: [1, 2, 3] },
      Loud: { preset: "custom", bands: curve.map(() => 40) },
      NotCustom: { preset: "rock", bands: curve },
      Ok: "rock",
    });
    expect([...parseDevicePresets(text)]).toEqual([["Ok", { preset: "rock" }]]);
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

  it("keeps the own curve with its bands", () => {
    const text = withDevicePreset(new Map(), "Headphones", { preset: "custom", bands: curve });
    expect(JSON.parse(text)).toEqual({ Headphones: { preset: "custom", bands: curve } });
    expect(parseDevicePresets(text).get("Headphones")).toEqual({ preset: "custom", bands: curve });
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

describe("sameChoice", () => {
  it("compares preset and bands", () => {
    expect(sameChoice({ preset: "flat" }, { preset: "flat" })).toBe(true);
    expect(sameChoice({ preset: "custom", bands: curve }, { preset: "custom", bands: [...curve] })).toBe(true);
    expect(sameChoice({ preset: "custom", bands: curve }, { preset: "custom", bands: curve.map((gain) => gain + 1) })).toBe(false);
    expect(sameChoice(undefined, { preset: "flat" })).toBe(false);
  });
});

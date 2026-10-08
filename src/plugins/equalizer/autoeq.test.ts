import { describe, expect, it } from "vitest";
import { parseAutoEq } from "./autoeq";

const FIXED_BAND = `Preamp: -6.6 dB
Filter 1: ON PK Fc 31 Hz Gain 6.3 dB Q 1.41
Filter 2: ON PK Fc 62 Hz Gain 4.1 dB Q 1.41
Filter 3: ON PK Fc 125 Hz Gain -1.6 dB Q 1.41
Filter 4: ON PK Fc 250 Hz Gain -2.4 dB Q 1.41
Filter 5: ON PK Fc 500 Hz Gain 0.6 dB Q 1.41
Filter 6: ON PK Fc 1000 Hz Gain -0.4 dB Q 1.41
Filter 7: ON PK Fc 2000 Hz Gain 2.6 dB Q 1.41
Filter 8: ON PK Fc 4000 Hz Gain -0.2 dB Q 1.41
Filter 9: ON PK Fc 8000 Hz Gain 3.4 dB Q 1.41
Filter 10: ON PK Fc 16000 Hz Gain -8.0 dB Q 1.41`;

describe("parseAutoEq", () => {
  it("takes a file for these ten bands over as it is", () => {
    expect(parseAutoEq(FIXED_BAND)).toEqual({ gains: [6, 4, -2, -2, 1, 0, 3, 0, 3, -8], preamp: -7 });
  });

  it("samples a parametric file at the ten bands", () => {
    const preset = parseAutoEq(`Preamp: -3.0 dB
Filter 1: ON LSC Fc 105 Hz Gain 6.0 dB Q 0.70
Filter 2: ON PK Fc 1000 Hz Gain -4.0 dB Q 1.41
Filter 3: ON HSC Fc 10000 Hz Gain -5.0 dB Q 0.70
Filter 4: OFF PK Fc 3000 Hz Gain 9.0 dB Q 1.00`);
    if (!preset) throw new Error("not parsed");
    const [sub, bass, , , , mid, , presence, , air] = preset.gains as [number, number, number, number, number, number, number, number, number, number];
    // The low shelf lifts the bass, the peak dips the middle, the high shelf cuts the top.
    expect(sub).toBeGreaterThanOrEqual(5);
    expect(bass).toBeGreaterThanOrEqual(3);
    expect(mid).toBe(-4);
    expect(air).toBeLessThanOrEqual(-3);
    // The filter that is switched off does nothing.
    expect(presence).toBeLessThanOrEqual(0);
    expect(preset.preamp).toBe(-3);
  });

  it("reads a graphic equalizer line between its points", () => {
    const preset = parseAutoEq("GraphicEQ: 20 6.0; 100 6.0; 1000 0.0; 10000 -6.0; 20000 -6.0");
    expect(preset?.gains).toEqual([6, 6, 5, 4, 2, 0, -2, -4, -5, -6]);
    // No value given: everything is lowered by the largest boost.
    expect(preset?.preamp).toBe(-6);
  });

  it("keeps everything within the sliders' range", () => {
    const preset = parseAutoEq("Preamp: -30 dB\nFilter 1: ON PK Fc 1000 Hz Gain 40 dB Q 1.41");
    expect(preset?.gains[5]).toBe(12);
    expect(preset?.preamp).toBe(-12);
  });

  it("copes with other line endings, spacing and case", () => {
    const preset = parseAutoEq("preamp: -2 db\r\n  filter 1: on pk fc 1000 hz gain 3 db q 1.41  \r\n");
    expect(preset?.gains[5]).toBe(3);
    expect(preset?.preamp).toBe(-2);
  });

  it("refuses text that holds no equalizer settings", () => {
    for (const text of ["", "hello", "Preamp: -3 dB", "Filter 1: OFF PK Fc 100 Hz Gain 3 dB Q 1", "GraphicEQ:", '{ "name": "x" }']) {
      expect(parseAutoEq(text), text).toBeNull();
    }
  });
});

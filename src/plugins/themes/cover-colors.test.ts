import { describe, expect, it } from "vitest";
import { averageColor, colorsFromRgb, toHsl, vividAverage } from "./cover-colors";

const lightness = (color: string): number => Number(/(\d+)%\)$/.exec(color)?.[1]);
const saturation = (color: string): number => Number(/ (\d+)% /.exec(color)?.[1]);
const hue = (color: string): number => Number(/^hsl\((\d+) /.exec(color)?.[1]);

describe("toHsl", () => {
  it("converts colors", () => {
    expect(toHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(toHsl({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 1, l: 0.5 });
    expect(toHsl({ r: 128, g: 128, b: 128 }).s).toBe(0);
    expect(toHsl({ r: 0, g: 128, b: 128 }).h).toBe(180);
  });
});

describe("colorsFromRgb", () => {
  it("keeps the cover's hue", () => {
    const { palette, accent } = colorsFromRgb({ r: 30, g: 60, b: 160 });
    for (const color of [...Object.values(palette), accent]) expect(hue(color)).toBeGreaterThan(215);
    for (const color of [...Object.values(palette), accent]) expect(hue(color)).toBeLessThan(235);
  });

  it("is always dark enough for white text and never garish", () => {
    for (const rgb of [{ r: 255, g: 255, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 250, g: 20, b: 20 }, { r: 0, g: 0, b: 0 }]) {
      const { palette } = colorsFromRgb(rgb);
      for (const color of Object.values(palette)) {
        expect(lightness(color)).toBeLessThanOrEqual(17);
        expect(saturation(color)).toBeLessThanOrEqual(45);
      }
      expect(lightness(palette.base)).toBeLessThan(lightness(palette.overlay));
    }
  });

  it("gives a grey scheme and a light grey accent for a grey cover", () => {
    const { palette, accent } = colorsFromRgb({ r: 90, g: 90, b: 90 });
    expect(saturation(palette.base)).toBe(0);
    expect(saturation(accent)).toBe(0);
    expect(lightness(accent)).toBe(80);
  });

  it("gives a clear accent even for a dull cover", () => {
    const { accent } = colorsFromRgb({ r: 60, g: 80, b: 100 });
    expect(saturation(accent)).toBeGreaterThanOrEqual(55);
    expect(lightness(accent)).toBe(62);
  });
});

describe("averageColor", () => {
  it("refuses addresses that are not covers", async () => {
    await expect(averageColor("https://example.com/cover.jpg")).rejects.toThrow("not a cover address");
    await expect(averageColor('https://i.ytimg.com/a.jpg") }')).rejects.toThrow("not a cover address");
  });
});

describe("vividAverage", () => {
  const pixels = (...colors: [number, number, number][]): number[] => colors.flatMap(([r, g, b]) => [r, g, b, 255]);

  it("lets the vivid part of a cover decide", () => {
    // Mostly grey, with a quarter in red.
    const color = vividAverage(pixels([120, 120, 120], [130, 130, 130], [110, 110, 110], [220, 30, 30]));
    expect(color.r).toBeGreaterThan(200);
    expect(color.g).toBeLessThan(50);
    expect(toHsl(color).s).toBeGreaterThan(0.6);
  });

  it("stays grey for a grey cover", () => {
    const color = vividAverage(pixels([40, 40, 40], [200, 200, 200]));
    expect(color).toEqual({ r: 120, g: 120, b: 120 });
  });

  it("copes with no pixels", () => {
    expect(vividAverage([])).toEqual({ r: 0, g: 0, b: 0 });
  });
});

// A color scheme and an accent taken from the cover of the playing song.
import { isSafeImageUrl, type Palette } from "./css";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface CoverColors {
  palette: Palette;
  accent: string;
}

/** Hue in degrees, saturation and lightness from 0 to 1. */
export function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === red) h = ((green - blue) / delta) % 6;
  else if (max === green) h = (blue - red) / delta + 2;
  else h = (red - green) / delta + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

const hsl = (h: number, s: number, l: number): string =>
  `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

/**
 * Colors for the page from a cover's average color: its hue, but always dark
 * enough for white text and never garish. A grey cover gives a grey scheme.
 */
export function colorsFromRgb(rgb: Rgb): CoverColors {
  const { h, s } = toHsl(rgb);
  // An average is duller than the cover looks; this brings some of it back.
  const tint = Math.min(0.45, s * 1.4);
  return {
    palette: {
      base: hsl(h, tint, 0.06),
      surface: hsl(h, tint, 0.11),
      bar: hsl(h, tint, 0.09),
      overlay: hsl(h, tint, 0.17),
    },
    accent: s < 0.08 ? hsl(h, 0, 0.8) : hsl(h, Math.max(0.55, Math.min(0.85, s * 2)), 0.62),
  };
}

const SAMPLE = 16;

/**
 * The color of some pixels (red, green, blue, alpha in turn), with vivid
 * pixels counting far more than grey ones. A plain average of a cover is
 * nearly always a dull brown or grey; this finds the color the eye picks out.
 */
export function vividAverage(data: ArrayLike<number>): Rgb {
  const sum = { r: 0, g: 0, b: 0 };
  let total = 0;
  for (let index = 0; index + 2 < data.length; index += 4) {
    const [r, g, b] = [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
    const spread = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    // Grey pixels still count a little, so that a grey cover stays grey.
    const weight = spread * spread + 0.01;
    sum.r += r * weight;
    sum.g += g * weight;
    sum.b += b * weight;
    total += weight;
  }
  return total === 0 ? { r: 0, g: 0, b: 0 } : { r: sum.r / total, g: sum.g / total, b: sum.b / total };
}

/**
 * The color of an image, see `vividAverage`. Rejects if the image cannot be loaded or
 * read; covers are only read from YouTube's image servers.
 */
export async function averageColor(url: string, doc: Document = document): Promise<Rgb> {
  if (!isSafeImageUrl(url)) throw new Error("not a cover address");
  const image = doc.createElement("img");
  // Without this the browser would not let the pixels be read.
  image.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("the cover did not load"));
    image.src = url;
  });
  const canvas = doc.createElement("canvas");
  canvas.width = canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no canvas");
  context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
  const { data } = context.getImageData(0, 0, SAMPLE, SAMPLE);
  return vividAverage(data);
}

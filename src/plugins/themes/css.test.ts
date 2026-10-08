import { describe, expect, it } from "vitest";
import { parseManifest, resolveSettings } from "../../core/plugin-manager/api";
import { BUILTIN_THEMES } from "./builtin";
import { ACCENTS, CONTENT_WIDTHS, COVER, PALETTES, coverCss, customCss, isSafeImageUrl, themeCss, usesCover } from "./css";
import manifestJson from "./plugin.json";

const manifest = parseManifest(manifestJson);
const defaults = resolveSettings(manifest, undefined);
const options = (key: string): string[] => {
  const field = manifest.settings?.[key];
  if (field?.type !== "select") throw new Error(`${key} must be a select`);
  return field.options.map((option) => option.value);
};

describe("manifest", () => {
  it("offers exactly the choices that exist", () => {
    expect(options("scheme")).toEqual(["default", ...Object.keys(PALETTES), COVER]);
    expect(options("accent")).toEqual(["default", ...Object.keys(ACCENTS), COVER]);
    expect(options("contentWidth")).toEqual(["default", ...Object.keys(CONTENT_WIDTHS)]);
  });

  it("has a multi-line field for custom CSS", () => {
    expect(manifest.settings?.customCss).toMatchObject({ type: "text", default: "" });
  });
});

describe("built-in themes", () => {
  it("only use settings and values the plugin has", () => {
    for (const theme of BUILTIN_THEMES) {
      expect(resolveSettings(manifest, theme.settings), theme.name).toEqual({ ...defaults, ...theme.settings });
      expect(Object.keys(theme.settings).every((key) => key in defaults), theme.name).toBe(true);
    }
  });

  it("have distinct names and files", () => {
    expect(new Set(BUILTIN_THEMES.map((theme) => theme.name)).size).toBe(BUILTIN_THEMES.length);
    expect(new Set(BUILTIN_THEMES.map((theme) => theme.file)).size).toBe(BUILTIN_THEMES.length);
  });
});

describe("colors from the cover", () => {
  const cover = {
    palette: { base: "hsl(220 40% 6%)", surface: "hsl(220 40% 11%)", bar: "hsl(220 40% 9%)", overlay: "hsl(220 40% 17%)" },
    accent: "hsl(220 70% 62%)",
  };

  it("are used for the scheme, the accent or both", () => {
    expect(usesCover(defaults)).toBe(false);
    expect(usesCover({ ...defaults, scheme: COVER })).toBe(true);
    expect(usesCover({ ...defaults, accent: COVER })).toBe(true);
    const scheme = themeCss({ ...defaults, scheme: COVER }, cover);
    expect(scheme).toContain("--ytmusic-background: hsl(220 40% 6%) !important");
    expect(scheme).not.toContain("--ytmusic-playback-progress-color");
    expect(themeCss({ ...defaults, accent: COVER }, cover)).toContain("--ytmusic-playback-progress-color: hsl(220 70% 62%) !important");
  });

  it("leave the page as it is until the cover has been read", () => {
    expect(themeCss({ ...defaults, scheme: COVER, accent: COVER })).toBe("");
    expect(themeCss({ ...defaults, scheme: COVER, accent: COVER }, null)).toBe("");
  });

  it("do not replace a fixed choice", () => {
    expect(themeCss({ ...defaults, scheme: "plum" }, cover)).toContain(PALETTES.plum?.base);
    expect(themeCss(defaults, cover)).toBe("");
  });
});

describe("themeCss", () => {
  it("is empty with the default settings, leaving the page untouched", () => {
    expect(themeCss(defaults)).toBe("");
  });

  it("sets the page's color variables for a scheme", () => {
    const css = themeCss({ scheme: "midnight", accent: "default" });
    expect(css).toContain("--ytmusic-background: #0b1020 !important");
    expect(css).toContain("--ytmusic-player-bar-background: #101730 !important");
    expect(css).not.toContain("--ytmusic-playback-progress-color");
  });

  it("sets the accent independently of the scheme", () => {
    const css = themeCss({ scheme: "default", accent: "green" });
    expect(css).toContain("--ytmusic-playback-progress-color: #22c55e !important");
    expect(css).not.toContain("--ytmusic-background");
  });

  it("combines scheme and accent", () => {
    const css = themeCss({ scheme: "amoled", accent: "pink" });
    expect(css).toContain("--ytmusic-background: #000000");
    expect(css).toContain("#ec4899");
  });

  it("ignores unknown values", () => {
    expect(themeCss({ scheme: "nope", accent: 5, contentWidth: "huge", blur: "lots" })).toBe("");
  });
});

describe("blur", () => {
  it("makes the bars translucent in the scheme's colors", () => {
    const css = themeCss({ scheme: "midnight", blur: 12 });
    expect(css).toContain("backdrop-filter: blur(12px)");
    expect(css).toContain("color-mix(in srgb, #0b1020 60%, transparent)");
    expect(css).toContain("color-mix(in srgb, #101730 60%, transparent)");
  });

  it("uses YouTube Music's colors without a scheme", () => {
    const css = themeCss({ ...defaults, blur: 8 });
    expect(css).toContain("color-mix(in srgb, #030303 60%, transparent)");
    expect(css).not.toContain("--ytmusic-background");
  });

  it("is off at zero and bounded above", () => {
    expect(themeCss({ ...defaults, blur: 0 })).toBe("");
    expect(themeCss({ ...defaults, blur: 999 })).toContain("blur(40px)");
  });
});

describe("layout", () => {
  it("sets the width of the content column", () => {
    expect(themeCss({ ...defaults, contentWidth: "narrow" })).toContain(
      "ytmusic-app { --ytmusic-content-width: min(calc(100vw - 200px - var(--ytmusic-guide-width) - var(--ytmusic-scrollbar-width)), 1050px) !important; }",
    );
    expect(themeCss({ ...defaults, contentWidth: "full" })).toContain(
      "ytmusic-app { --ytmusic-content-width: calc(100vw - 64px - var(--ytmusic-guide-width) - var(--ytmusic-scrollbar-width)) !important; }",
    );
  });

});

describe("cover background", () => {
  const cover = "https://i.ytimg.com/vi/abc/sddefault.jpg?sqp=-oaymwE&rs=AOn4CL";

  it("puts the cover behind the page when switched on", () => {
    const css = coverCss({ coverBackground: true }, cover);
    expect(css).toContain(`url("${cover}")`);
    expect(css).toContain("blur(60px)");
  });

  it("is empty when off or without a cover", () => {
    expect(coverCss({ coverBackground: false }, cover)).toBe("");
    expect(coverCss({ coverBackground: true }, null)).toBe("");
  });

  it("accepts only covers from YouTube's image servers", () => {
    expect(isSafeImageUrl(cover)).toBe(true);
    expect(isSafeImageUrl("https://lh3.googleusercontent.com/abc=w544-h544")).toBe(true);
    expect(isSafeImageUrl("https://evil.example/x.jpg")).toBe(false);
    expect(isSafeImageUrl("https://ytimg.com.evil.example/x.jpg")).toBe(false);
    expect(isSafeImageUrl("http://i.ytimg.com/x.jpg")).toBe(false);
    expect(isSafeImageUrl("not a url")).toBe(false);
  });

  it("refuses anything that could break out of the stylesheet", () => {
    for (const url of [
      'https://i.ytimg.com/x.jpg"); } body { display: none } /*',
      "https://i.ytimg.com/x.jpg)",
      "https://i.ytimg.com/x.jpg\\",
      "https://i.ytimg.com/x .jpg",
      "https://i.ytimg.com/x.jpg'",
    ]) {
      expect(isSafeImageUrl(url), url).toBe(false);
      expect(coverCss({ coverBackground: true }, url)).toBe("");
    }
  });
});

describe("customCss", () => {
  it("returns the trimmed text, or nothing", () => {
    expect(customCss({ customCss: "  body { color: red }\n" })).toBe("body { color: red }");
    expect(customCss({ customCss: "   " })).toBe("");
    expect(customCss({})).toBe("");
  });
});

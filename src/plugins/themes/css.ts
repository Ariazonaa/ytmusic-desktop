import { isSafeImageUrl } from "../../core/net/cover-url";
import type { PluginSettingValues } from "../../shared/types";

export { isSafeImageUrl };

export interface Palette {
  /** Page background. */
  base: string;
  /** Raised surfaces: cards, alerts, hovered rows. */
  surface: string;
  /** The player bar and other chrome. */
  bar: string;
  /** Menus and dialogs. */
  overlay: string;
}

/** YouTube Music's own colors, used where an effect needs them and no scheme is chosen. */
const DEFAULT_PALETTE: Palette = { base: "#030303", surface: "#181818", bar: "#212121", overlay: "#333333" };

/** `default` is YouTube Music's own look and has no palette. */
export const PALETTES: Readonly<Record<string, Palette>> = {
  amoled: { base: "#000000", surface: "#0a0a0a", bar: "#000000", overlay: "#141414" },
  slate: { base: "#111418", surface: "#1a1e24", bar: "#161a1f", overlay: "#252a32" },
  midnight: { base: "#0b1020", surface: "#141b33", bar: "#101730", overlay: "#1d2647" },
  forest: { base: "#0c1410", surface: "#14211a", bar: "#101a14", overlay: "#1d3026" },
  plum: { base: "#150d1a", surface: "#21142a", bar: "#1a1021", overlay: "#301d3c" },
};

/** The choice of scheme and accent that takes its colors from the cover of the playing song. */
export const COVER = "cover";

/** Whether the settings need the colors of the cover. */
export const usesCover = (settings: PluginSettingValues): boolean =>
  settings.scheme === COVER || settings.accent === COVER;

/** `default` keeps YouTube Music's red. */
export const ACCENTS: Readonly<Record<string, string>> = {
  blue: "#3b82f6",
  green: "#22c55e",
  purple: "#a855f7",
  orange: "#f97316",
  pink: "#ec4899",
};

// What the window leaves for the content column, next to the guide and the scrollbar.
const available = (margin: string): string =>
  `calc(100vw - ${margin} - var(--ytmusic-guide-width) - var(--ytmusic-scrollbar-width))`;

/**
 * Widths of the page's content column. `default` is YouTube Music's own: what
 * the window leaves, but 1478px at most.
 */
export const CONTENT_WIDTHS: Readonly<Record<string, string>> = {
  narrow: `min(${available("200px")}, 1050px)`,
  full: available("64px"),
};

// YouTube Music defines its colors as variables on these elements.
const SCOPE = "html, body, ytmusic-app";

function paletteCss(palette: Palette): string {
  return `
${SCOPE} {
  --ytmusic-background: ${palette.base} !important;
  --ytmusic-color-black4: ${palette.base} !important;
  --ytmusic-general-background-c: ${palette.base} !important;
  --ytmusic-nav-bar: ${palette.base} !important;
  --ytmusic-detail-header: ${palette.base} !important;
  --ytmusic-color-black2: ${palette.surface} !important;
  --ytmusic-general-background-a: ${palette.surface} !important;
  --ytmusic-alert-with-actions-background: ${palette.surface} !important;
  --ytmusic-color-black1: ${palette.bar} !important;
  --ytmusic-brand-background-solid: ${palette.bar} !important;
  --ytmusic-player-bar-background: ${palette.bar} !important;
  --ytmusic-dropdown-background: ${palette.overlay} !important;
  --ytmusic-dialog-background-color: ${palette.overlay} !important;
}
body, #guide-wrapper.ytmusic-app, #mini-guide-background.ytmusic-app { background: ${palette.base} !important; }
ytmusic-player-bar, #player-bar-background.ytmusic-app-layout { background: ${palette.bar} !important; }
`;
}

function accentCss(accent: string): string {
  return `
${SCOPE} {
  --ytmusic-playback-progress-color: ${accent} !important;
  --paper-slider-active-color: ${accent} !important;
  --paper-slider-knob-color: ${accent} !important;
  --ytmusic-brand-link-text: ${accent} !important;
}
#progress-bar.ytmusic-player-bar {
  --paper-slider-active-color: ${accent} !important;
  --paper-slider-knob-color: ${accent} !important;
}
`;
}

/**
 * Frosted glass for the bars: they become translucent and blur what scrolls
 * underneath. The backgrounds sit on separate elements behind the bars.
 */
function blurCss(pixels: number, palette: Palette): string {
  const glass = (color: string): string => `color-mix(in srgb, ${color} 60%, transparent)`;
  const filter = `blur(${pixels}px) saturate(1.4)`;
  return `
#nav-bar-background.ytmusic-app-layout {
  background: ${glass(palette.base)} !important;
  backdrop-filter: ${filter};
}
#nav-bar-divider.ytmusic-app-layout { background: transparent !important; }
ytmusic-player-bar { background: transparent !important; }
#player-bar-background.ytmusic-app-layout {
  background: ${glass(palette.bar)} !important;
  backdrop-filter: ${filter};
}
.ytmd-panel {
  background: ${glass(palette.base)} !important;
  backdrop-filter: ${filter};
}
`;
}

function layoutCss(settings: PluginSettingValues): string {
  const width = CONTENT_WIDTHS[String(settings.contentWidth)];
  // The page sets the width on ytmusic-app, where the guide's width is known.
  return width ? `\nytmusic-app { --ytmusic-content-width: ${width} !important; }\n` : "";
}

/**
 * The stylesheet for color scheme, accent, blur and layout. Empty for the
 * defaults, so that the page is left untouched.
 */
export function themeCss(
  settings: PluginSettingValues,
  cover: { palette: Palette; accent: string } | null = null,
): string {
  // `cover` holds the colors of the playing song's cover, once they are known.
  const palette = settings.scheme === COVER ? cover?.palette : PALETTES[String(settings.scheme)];
  const accent = settings.accent === COVER ? cover?.accent : ACCENTS[String(settings.accent)];
  const blur = typeof settings.blur === "number" && settings.blur > 0 ? Math.min(40, settings.blur) : 0;
  return (
    (palette ? paletteCss(palette) : "") +
    (accent ? accentCss(accent) : "") +
    (blur > 0 ? blurCss(blur, palette ?? DEFAULT_PALETTE) : "") +
    layoutCss(settings)
  );
}

/** The cover of the playing song as a blurred, darkened page background. */
export function coverCss(settings: PluginSettingValues, artworkUrl: string | null): string {
  if (settings.coverBackground !== true || !artworkUrl || !isSafeImageUrl(artworkUrl)) return "";
  return `
body::before {
  content: "";
  position: fixed;
  inset: -80px;
  z-index: -1;
  background: url("${artworkUrl}") center / cover no-repeat;
  filter: blur(60px) brightness(0.35) saturate(1.3);
  pointer-events: none;
}
`;
}

/** The user's own CSS. It is applied after the theme, so it wins. */
export function customCss(settings: PluginSettingValues): string {
  return typeof settings.customCss === "string" ? settings.customCss.trim() : "";
}

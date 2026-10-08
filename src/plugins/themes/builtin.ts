import type { SharedFile } from "../../shared/types";

/** Marks a theme that comes with the app rather than from the themes folder. */
export const BUILTIN_PREFIX = "builtin:";

/** Ready-made looks, listed in the panel above the user's own theme files. */
export const BUILTIN_THEMES: readonly SharedFile[] = [
  {
    file: `${BUILTIN_PREFIX}midnight-glass`,
    name: "Midnight glass",
    settings: { scheme: "midnight", accent: "blue", blur: 14, coverBackground: false, contentWidth: "default", customCss: "" },
  },
  {
    file: `${BUILTIN_PREFIX}forest`,
    name: "Forest",
    settings: { scheme: "forest", accent: "green", blur: 8, coverBackground: false, contentWidth: "default", customCss: "" },
  },
  {
    file: `${BUILTIN_PREFIX}stage`,
    name: "Stage",
    settings: { scheme: "amoled", accent: "pink", blur: 18, coverBackground: true, contentWidth: "default", customCss: "" },
  },
  {
    file: `${BUILTIN_PREFIX}cover`,
    name: "Colors of the cover",
    settings: { scheme: "cover", accent: "cover", blur: 12, coverBackground: false, contentWidth: "default", customCss: "" },
  },
];

// Themes: color schemes, an accent color, blur, layout options and the user's
// own CSS. A look can be saved as a theme file and passed on.
import { parseManifest, resolveSettings } from "../../core/plugin-manager/api";
import { listShared, openSharedFolder, saveShared } from "../../core/settings/client";
import type { Panel, Plugin, PluginApi, SharedFile } from "../../shared/types";
import { BUILTIN_THEMES } from "./builtin";
import { averageColor, colorsFromRgb, type CoverColors } from "./cover-colors";
import { coverCss, customCss, themeCss, usesCover } from "./css";
import manifestJson from "./plugin.json";
import { UI_CSS, createThemesUi, type ThemesUi } from "./ui";
import { t } from "../../core/i18n";

const manifest = parseManifest(manifestJson);

let api: PluginApi | undefined;
let removers: (() => void)[] = [];
let artworkUrl: string | null = null;
let panel: Panel | undefined;
let ui: ThemesUi | undefined;
/** The colors of the cover in `artworkUrl`, once read, and a count that drops outdated reads. */
let coverColors: CoverColors | null = null;
let coverRead = 0;

function apply(): void {
  if (!api) return;
  const pluginApi = api;
  for (const remove of removers) remove();
  const settings = pluginApi.settings.getAll();
  // Separate stylesheets: a mistake in the custom CSS must not take the theme down with it.
  removers = [themeCss(settings, coverColors), coverCss(settings, artworkUrl), customCss(settings)]
    .filter((css) => css !== "")
    .map((css) => pluginApi.ui.injectCss(css));
}

/** Reads the colors of the current cover if the settings ask for them, then applies them. */
async function readCover(): Promise<void> {
  const read = ++coverRead;
  const url = artworkUrl;
  if (!api || !url || !usesCover(api.settings.getAll())) {
    const hadColors = coverColors !== null;
    coverColors = null;
    if (api && hadColors) apply();
    return;
  }
  // A cover that cannot be read leaves YouTube Music's own colors.
  const colors = await averageColor(url).then(colorsFromRgb, () => null);
  if (read !== coverRead) return;
  coverColors = colors;
  apply();
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function refresh(): Promise<void> {
  try {
    ui?.setThemes([...BUILTIN_THEMES, ...(await listShared("themes"))]);
  } catch (error) {
    ui?.setMessage(t("Could not read the themes folder: {reason}", { reason: describe(error) }));
  }
}

/** Takes over the settings in a theme file. What does not fit the schema falls back to the default. */
async function applyTheme(pluginApi: PluginApi, theme: SharedFile): Promise<void> {
  try {
    await pluginApi.settings.update(resolveSettings(manifest, theme.settings));
    ui?.setMessage(t('Applied "{name}".', { name: theme.name }));
  } catch (error) {
    ui?.setMessage(t("Could not apply the theme: {reason}", { reason: describe(error) }));
  }
}

async function saveCurrent(pluginApi: PluginApi, name: string): Promise<void> {
  try {
    await saveShared("themes", name, pluginApi.settings.getAll());
    ui?.setMessage(t("Saved") + ` "${name.trim()}".`);
    await refresh();
  } catch (error) {
    ui?.setMessage(t("Could not save: {reason}", { reason: describe(error) }));
  }
}

const themes: Plugin = {
  manifest,

  onLoad(pluginApi) {
    api = pluginApi;
    artworkUrl = api.music.getCurrentSong()?.artworkUrl ?? null;
    api.ui.injectCss(UI_CSS);
    api.ui.addNavButton(t("Themes"), () => {
      if (panel?.open) {
        panel.hide();
      } else {
        panel?.show();
        void refresh();
      }
    });
    apply();
    void readCover();
  },

  onUIReady() {
    if (!api) return;
    const pluginApi = api;
    panel = pluginApi.ui.addPanel(t("Themes"));
    ui = createThemesUi(panel.body, {
      onApply: (theme) => void applyTheme(pluginApi, theme),
      onSave: (name) => void saveCurrent(pluginApi, name),
      onRefresh: () => void refresh(),
      onOpenFolder: () => {
        openSharedFolder("themes").catch((error: unknown) => ui?.setMessage(describe(error)));
      },
    });
    void refresh();
  },

  onSongChange(song) {
    artworkUrl = song.artworkUrl;
    apply();
    void readCover();
  },

  onSettingsChange() {
    apply();
    void readCover();
  },

  onUnload() {
    // The API removes the injected CSS, the button and the panel.
    removers = [];
    api = panel = ui = undefined;
    artworkUrl = null;
    coverColors = null;
    coverRead++;
  },
};

export default themes;

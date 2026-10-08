// Entry point of the script Rust injects into the main window. It runs on
// every navigation, before the page's own scripts.
import { injectCss } from "../core/injector/css";
import { SELECTORS, waitForElement } from "../core/injector/dom";
import { addNavButton } from "../core/injector/nav-button";
import { showNotice } from "../core/injector/notice";
import { createPanel } from "../core/injector/panel";
import { addSettingsButton } from "../core/injector/settings-button";
import { createExternalPlugin } from "../core/plugin-manager/external";
import { PluginManager } from "../core/plugin-manager/manager";
import { AudioChain } from "../core/audio/chain";
import { OutputDeviceWatcher } from "../core/audio/output-device";
import { HealthReporter, checkPage } from "../core/health";
import { setLanguage } from "../core/i18n";
import { navigate } from "../core/injector/navigate";
import { addShortcut } from "../core/injector/shortcuts";
import { describeLogArguments, fileLogger } from "../core/log";
import { Notifier } from "../core/notify";
import { getJson, sendRequest } from "../core/net/json";
import { addToQueue, moveInQueue, readQueue, removeFromQueue } from "../core/player/queue";
import { controlPlayer, seekTo, setPlaybackRate } from "../core/player/controls";
import { readLikeStatus, setLikeStatus } from "../core/player/like";
import { readLoudnessLkfs, readPlaybackState, readVideoId, watchPlayback } from "../core/player/playback";
import { startResume } from "../core/player/resume";
import { SongWatcher, readCurrentSong } from "../core/player/song";
import { getVolume, setVolume } from "../core/player/volume";
import {
  getOutputDevice,
  getSettings,
  listExternalPlugins,
  logError,
  notify,
  openSettings,
  reportHealth,
  setNowPlaying,
  setSettings,
} from "../core/settings/client";
import { builtinPlugins } from "../plugins";
import { validateExternalPlugins } from "../plugins/external";
import type { PlaybackState, PlayerAction, Plugin, Settings, Song } from "../shared/types";

/** Errors go to the console and to the app's log file. */
const log = fileLogger(logError);

/** Notifications of the operating system, and what to do when one is clicked. */
const notifier = new Notifier(notify);

/** Which device the sound goes to. */
const outputDevice = new OutputDeviceWatcher(getOutputDevice);

/** What does not work, for the settings window. */
const health = new HealthReporter(reportHealth);
/** How long after the first song the page is checked: its parts appear one after the other. */
const PAGE_CHECK_DELAY_MS = 5000;

/** Plugins from the user's plugins folder, each wrapped to run in a sandboxed iframe. */
async function loadExternalPlugins(): Promise<Plugin[]> {
  const found = await listExternalPlugins().catch((error: unknown) => {
    log.error("[ytm-desktop] could not list external plugins", error);
    return [];
  });
  const builtinNames = builtinPlugins.map((plugin) => plugin.manifest.name);
  return validateExternalPlugins(found, builtinNames, (folder, reason) => {
    log.warn(`[ytm-desktop] ignoring external plugin "${folder}": ${reason}`);
  }).map(({ manifest, frameUrl }) =>
    createExternalPlugin(manifest, frameUrl, document, {
      // Errors a plugin's own code throws arrive here.
      error(...args: unknown[]) {
        log.error(...args);
        health.addPluginError(manifest.name, describeLogArguments(args.slice(1)));
      },
    }),
  );
}

async function start(): Promise<void> {
  const [settings, externalPlugins] = await Promise.all([getSettings(), loadExternalPlugins()]);
  // Before any plugin builds its buttons and panels.
  setLanguage(settings.language);
  startResume(settings.resumePlayback);
  let current = settings;
  const audioChain = new AudioChain();
  /** How far the heard sound lags behind the player, in seconds of the track. */
  let outputDelay = 0;

  const music = {
    getCurrentSong: () => watcher.current,
    getPlaybackState() {
      const state = readPlaybackState();
      if (!state || outputDelay === 0) return state;
      // An effect holds the sound back: report what is heard, not what the player is at.
      return { ...state, positionSeconds: Math.max(0, state.positionSeconds - outputDelay) };
    },
    getVideoId: () => readVideoId(),
    getLoudnessLkfs: () => readLoudnessLkfs(),
    getLikeStatus: () => readLikeStatus(),
    getQueue: () => readQueue(),
  };
  const manager = new PluginManager(builtinPlugins, {
    music,
    player: {
      seekTo,
      setPlaybackRate,
      getVolume,
      setVolume,
      next: () => controlPlayer("next"),
      setLikeStatus: (status) => setLikeStatus(status),
      addToQueue: (videoId, position = "next") => addToQueue(videoId, position),
      removeFromQueue: (index) => removeFromQueue(index),
      moveInQueue: (from, to) => moveInQueue(from, to),
    },
    audio: {
      addEffect: (order, build) => audioChain.addEffect(order, build),
      setOutputDelay(seconds) {
        outputDelay = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
      },
      getOutputDevice: () => outputDevice.current(),
      onOutputDeviceChange: (handler) => outputDevice.onChange(handler),
    },
    ui: {
      injectCss,
      waitForElement,
      showNotice: (text, action) => showNotice(text, action),
      addNavButton,
      addPanel: (title) => createPanel(title),
      addShortcut: (shortcut, onPress) => addShortcut(shortcut, onPress),
      navigate: (target) => navigate(target),
    },
    net: { getJson, request: sendRequest },
    notify: { show: (title, body, options) => notifier.show(title, body, options) },
    reportPluginError: (plugin, message) => health.addPluginError(plugin, message),
    saveSettings(plugin, values) {
      // The backend sends the saved settings back through `applySettings`.
      const pluginSettings = {
        ...current.pluginSettings,
        [plugin]: { ...current.pluginSettings[plugin], ...values },
      };
      current = { ...current, pluginSettings };
      return setSettings(current);
    },
  }, log);
  let pageChecked = false;
  const watcher = new SongWatcher(readCurrentSong, (song) => {
    manager.notifySongChange(song);
    if (!pageChecked) {
      // Only with a song is all of the player bar there to be looked at.
      pageChecked = true;
      setTimeout(() => health.setPageProblems(checkPage()), PAGE_CHECK_DELAY_MS);
    }
    // For the tray's tooltip and menu.
    setNowPlaying(song.title, song.artist).catch(() => {});
  });

  /** The external plugins as last read from the folder. */
  let external = externalPlugins;
  manager.setExternalPlugins(externalPlugins);
  manager.setPluginSettings(settings.pluginSettings);
  manager.enable(current.plugins);
  hooks.applySettings = (changed) => {
    if (changed.language !== current.language) {
      // Plugins put their texts on the page when they start: with another
      // language they all start again.
      setLanguage(changed.language);
      manager.setEnabled([]);
    }
    current = changed;
    manager.setPluginSettings(changed.pluginSettings);
    manager.setEnabled(changed.plugins);
  };
  hooks.inspect = () => ({
    song: music.getCurrentSong(),
    playback: music.getPlaybackState(),
    videoId: music.getVideoId(),
  });
  hooks.reloadPlugins = async () => {
    const reloaded = await loadExternalPlugins();
    // Their code starts afresh, so what went wrong before no longer counts.
    for (const plugin of [...external, ...reloaded]) health.clearPlugin(plugin.manifest.name);
    external = reloaded;
    manager.setExternalPlugins(reloaded);
    manager.setEnabled(current.plugins);
  };
  watcher.start();
  watchPlayback((state) => manager.notifyPlaybackChange(state));
  const navBar = await waitForElement(SELECTORS.navBar);
  addSettingsButton(navBar, () => void openSettings());
  manager.notifyUIReady();
}

interface Hooks {
  /** Used by the tray menu. */
  control: (action: PlayerAction) => void;
  /** Applies settings changed in the settings window without a restart. */
  applySettings?: (settings: Settings) => void;
  /** Reads the plugins folder again and restarts the external plugins. */
  reloadPlugins?: () => Promise<void>;
  /** A notification a plugin asked for was clicked. */
  notificationClicked: (id: number) => void;
  /** What plugins are told about the playing song. Read by `scripts/e2e-transition.mjs`. */
  inspect?: () => { song: Song | null; playback: PlaybackState | null; videoId: string | null };
}

const hooks: Hooks = {
  control(action) {
    // Lets a restored track that is held paused know the user wants to hear it.
    window.dispatchEvent(new Event("ytmd-control"));
    controlPlayer(action);
  },
  notificationClicked: (id) => notifier.clicked(id),
};

declare global {
  interface Window {
    /** Called from Rust, see `control_player`, `apply_settings`, `reload_plugins` and `notification_clicked` in `window.rs`. */
    __ytmDesktop?: Hooks;
  }
}

// The window also visits the Google sign-in pages; plugins only run on YouTube Music itself.
if (window.top === window && location.hostname === "music.youtube.com") {
  window.__ytmDesktop = hooks;
  start().catch((error: unknown) => {
    log.error("[ytm-desktop] failed to start", error);
  });
}

<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    exportSettings,
    getHealth,
    getSettings,
    isFirstRun,
    importSettings,
    installPlugin,
    openLog,
    openPluginsFolder,
    reloadPlugins,
    removePlugin,
    restartApp,
    restartRequired,
    setSettings,
  } from "../core/settings/client";
  import { conflict, resolveSettings } from "../core/plugin-manager/api";
  import { PLUGIN_CATEGORIES } from "../shared/types";
  import type { Health, PluginCategory, Settings, SettingValue, Shortcuts } from "../shared/types";
  import { resolveLanguage, translator } from "./i18n";
  import { listPlugins, type ListedPlugin } from "./plugins";
  import PluginSettings from "./PluginSettings.svelte";
  import ShortcutField from "./ShortcutField.svelte";
  import Toggle from "./Toggle.svelte";

  let settings = $state<Settings | null>(null);
  let plugins = $state<ListedPlugin[]>([]);
  let rejected = $state<string[]>([]);
  let error = $state<string | null>(null);
  /** A setting differs from what the running app uses. */
  let needsRestart = $state(false);

  const language = $derived(resolveLanguage(settings?.language ?? "system", navigator.language));
  const t = $derived(translator(language));

  $effect(() => {
    document.documentElement.lang = language;
    // Fails outside the app, e.g. when the page is opened in a browser.
    getCurrentWindow()
      .setTitle(t("Settings"))
      .catch(() => {});
  });

  /** What does not work at the moment, as the main window reports it. */
  let health = $state<Health>({ pageProblems: [], pluginErrors: {} });
  /** The app runs for the first time: say where to begin. */
  let welcome = $state(false);
  let search = $state("");

  isFirstRun().then(
    (first) => (welcome = first),
    () => {},
  );
  // Asked again and again: problems show up while the window is open.
  $effect(() => {
    const refresh = (): void => {
      getHealth().then(
        (latest) => (health = latest),
        () => {},
      );
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  });

  const CATEGORY_LABELS: Record<PluginCategory, string> = {
    audio: "Sound",
    appearance: "Appearance",
    playback: "Playback",
    tools: "Tools",
  };
  /** The plugins that match the search, by category, in the order the categories are listed. */
  const groups = $derived.by(() => {
    const wanted = search.trim().toLowerCase();
    const matches = ({ manifest }: ListedPlugin): boolean =>
      wanted === "" ||
      manifest.name.includes(wanted) ||
      t(manifest.description ?? "").toLowerCase().includes(wanted) ||
      (manifest.description ?? "").toLowerCase().includes(wanted);
    return PLUGIN_CATEGORIES.map((category) => ({
      category,
      plugins: plugins.filter((plugin) => (plugin.manifest.category ?? "tools") === category && matches(plugin)),
    })).filter((group) => group.plugins.length > 0);
  });

  /** A part of YouTube Music's page, in words. */
  const pagePart = (name: string): string =>
    name.startsWith("player.")
      ? t("the player's function {name}", { name: name.slice("player.".length) })
      : t(
          {
            navBar: "the navigation bar",
            playerBar: "the player bar",
            nextButton: "the Next button",
            previousButton: "the Previous button",
            volumeSlider: "the volume slider",
            muteButton: "the mute button",
            timeInfo: "the time display",
            progressBar: "the progress bar",
            likeButtons: "the like buttons",
            player: "the player",
          }[name] ?? name,
        );

  async function checkRestart(): Promise<void> {
    needsRestart = await restartRequired().catch(() => false);
  }
  void checkRestart();

  getSettings().then(
    (loaded) => (settings = loaded),
    (reason: unknown) => (error = t("Could not load settings: {reason}", { reason: String(reason) })),
  );
  async function refreshPlugins(): Promise<void> {
    try {
      ({ plugins, rejected } = await listPlugins());
    } catch (reason) {
      error = t("Could not list plugins: {reason}", { reason: String(reason) });
    }
  }
  void refreshPlugins();

  /** Picks up new and edited external plugins, here and in the main window. */
  async function reload(): Promise<void> {
    await refreshPlugins();
    try {
      await reloadPlugins();
    } catch (reason) {
      error = t("Could not reload plugins: {reason}", { reason: String(reason) });
    }
  }

  // Every change is saved at once. The switch flips immediately and flips
  // back if the backend refuses the change.
  async function update(patch: Partial<Settings>): Promise<void> {
    if (!settings) return;
    const previous = settings;
    settings = { ...previous, ...patch };
    try {
      await setSettings(settings);
      error = null;
      void checkRestart();
    } catch (reason) {
      settings = previous;
      error = t("Could not save settings: {reason}", { reason: String(reason) });
    }
  }

  /** Says which plugins were switched off to make room for another, or what a button did. */
  let notice = $state<string | null>(null);
  let backupNotice = $state<string | null>(null);

  const rivalsOf = (name: string): string[] => {
    const manifest = plugins.find((plugin) => plugin.manifest.name === name)?.manifest;
    if (!manifest) return [];
    return plugins
      .filter((other) => other.manifest.name !== name && conflict(manifest, other.manifest))
      .map((other) => other.manifest.name);
  };

  function setPluginEnabled(name: string, enabled: boolean): void {
    if (!settings) return;
    // Plugins that cannot run together are never enabled at the same time.
    const rivals = enabled ? rivalsOf(name) : [];
    const displaced = settings.plugins.filter((plugin) => rivals.includes(plugin));
    const others = settings.plugins.filter((plugin) => plugin !== name && !rivals.includes(plugin));
    notice =
      displaced.length > 0
        ? t("Switched off {names}, which cannot run together with {name}.", {
            names: displaced.join(t(" and ")),
            name,
          })
        : null;
    void update({ plugins: enabled ? [...others, name] : others });
  }

  /** Puts the settings the window shows for a plugin back to their defaults. What the plugin keeps for itself stays. */
  function resetPluginSettings(name: string): void {
    if (!settings) return;
    const schema = plugins.find((plugin) => plugin.manifest.name === name)?.manifest.settings ?? {};
    const kept = Object.fromEntries(
      Object.entries(settings.pluginSettings[name] ?? {}).filter(([key]) => schema[key]?.hidden === true),
    );
    void update({ pluginSettings: { ...settings.pluginSettings, [name]: kept } });
  }

  function setPluginSetting(name: string, key: string, value: SettingValue): void {
    if (!settings) return;
    const pluginSettings = {
      ...settings.pluginSettings,
      [name]: { ...settings.pluginSettings[name], [key]: value },
    };
    void update({ pluginSettings });
  }

  const SHORTCUT_ACTIONS: (keyof Shortcuts)[] = [
    "playPause",
    "next",
    "previous",
    "volumeUp",
    "volumeDown",
    "toggleMute",
  ];
  const shortcutLabel = (action: keyof Shortcuts): string =>
    ({
      playPause: t("Play / Pause"),
      next: t("Next"),
      previous: t("Previous"),
      volumeUp: t("Volume up"),
      volumeDown: t("Volume down"),
      toggleMute: t("Mute / Unmute"),
    })[action];

  function setShortcut(action: keyof Shortcuts, shortcut: string): void {
    if (!settings) return;
    void update({ shortcuts: { ...settings.shortcuts, [action]: shortcut } });
  }

  /** The external plugin whose Remove button was pressed once; a second press removes it. */
  let removing = $state<string | null>(null);

  async function installFromZip(): Promise<void> {
    try {
      const name = await installPlugin();
      if (name === null) return;
      await refreshPlugins();
      notice = t("Installed {name}. Switch it on in the list above.", { name });
      error = null;
    } catch (reason) {
      error = t("Could not install the plugin: {reason}", { reason: String(reason) });
    }
  }

  async function remove(name: string): Promise<void> {
    if (removing !== name) {
      removing = name;
      return;
    }
    removing = null;
    try {
      settings = await removePlugin(name);
      await refreshPlugins();
      notice = t("Removed {name}.", { name });
      error = null;
    } catch (reason) {
      error = t("Could not remove the plugin: {reason}", { reason: String(reason) });
    }
  }

  function showPluginsFolder(): void {
    openPluginsFolder().catch((reason: unknown) => {
      error = t("Could not open the plugins folder: {reason}", { reason: String(reason) });
    });
  }

  function showLog(): void {
    openLog().catch((reason: unknown) => {
      error = t("Could not open the log: {reason}", { reason: String(reason) });
    });
  }

  async function exportToFile(): Promise<void> {
    backupNotice = null;
    try {
      if (await exportSettings()) backupNotice = t("Settings exported.");
      error = null;
    } catch (reason) {
      error = t("Could not export the settings: {reason}", { reason: String(reason) });
    }
  }

  async function importFromFile(): Promise<void> {
    backupNotice = null;
    try {
      const imported = await importSettings();
      if (imported) {
        settings = imported;
        backupNotice = t("Settings imported.");
        void checkRestart();
      }
      error = null;
    } catch (reason) {
      error = t("Could not import the settings: {reason}", { reason: String(reason) });
    }
  }
</script>

{#snippet action(label: string, run: () => void)}
  <button
    type="button"
    class="rounded-md border border-neutral-700 px-3 py-1.5 hover:bg-neutral-800
      focus-visible:outline-2 focus-visible:outline-white"
    onclick={run}
  >
    {label}
  </button>
{/snippet}

<main class="mx-auto max-w-xl px-6 py-6 text-sm">
  {#if error}
    <p role="alert" class="mb-4 rounded-md border border-red-800 bg-red-950 px-3 py-2 text-red-200">
      {error}
    </p>
  {/if}

  {#if welcome}
    <p class="mb-4 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2">
      <span class="block font-medium">{t("Welcome!")}</span>
      {t(
        "No plugin is switched on yet. Choose the ones you like under Plugins; each takes effect at once. This window opens again with the gear button in YouTube Music or from the tray icon.",
      )}
    </p>
  {/if}

  {#if health.pageProblems.length > 0}
    <p role="alert" class="mb-4 rounded-md border border-amber-700 bg-amber-950 px-3 py-2 text-amber-100">
      <span class="block font-medium">{t("YouTube Music has changed")}</span>
      {t("The app could not find {parts}. What depends on it may not work until the app is updated.", {
        parts: health.pageProblems.map(pagePart).join(", "),
      })}
    </p>
  {/if}

  {#if settings}
    <section>
      <h2 class="mb-1 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        {t("General")}
      </h2>
      <div class="divide-y divide-neutral-800 rounded-lg bg-neutral-900 px-4">
        <Toggle checked={settings.startup} onchange={(startup) => update({ startup })}>
          <span class="block font-medium">{t("Start with Windows")}</span>
          <span class="block text-neutral-400">{t("Launch the app when you sign in.")}</span>
        </Toggle>
        <Toggle checked={settings.startInTray} onchange={(startInTray) => update({ startInTray })}>
          <span class="block font-medium">{t("Start in the tray")}</span>
          <span class="block text-neutral-400">
            {t(
              "When Windows launches the app at sign-in, no window opens. Click the tray icon to show it.",
            )}
          </span>
        </Toggle>
        <Toggle
          checked={settings.minimizeToTray}
          onchange={(minimizeToTray) => update({ minimizeToTray })}
        >
          <span class="block font-medium">{t("Minimize to tray")}</span>
          <span class="block text-neutral-400">
            {t("Closing the window keeps the music playing. Quit from the tray menu.")}
          </span>
        </Toggle>
        <Toggle
          checked={settings.resumePlayback}
          onchange={(resumePlayback) => update({ resumePlayback })}
        >
          <span class="block font-medium">{t("Resume the last track")}</span>
          <span class="block text-neutral-400">
            {t("When the app starts, it loads the track from last time, paused where you stopped.")}
          </span>
        </Toggle>
        <Toggle
          checked={settings.hardwareAcceleration}
          onchange={(hardwareAcceleration) => update({ hardwareAcceleration })}
        >
          <span class="block font-medium">{t("Hardware acceleration")}</span>
          <span class="block text-neutral-400">
            {t(
              "Off saves memory but uses more processor time, mostly for videos. Applies after a restart.",
            )}
          </span>
        </Toggle>
        {#if needsRestart}
          <div class="flex items-center justify-between gap-4 py-3">
            <span class="text-amber-300">{t("Restart the app to apply this change.")}</span>
            <button
              type="button"
              class="shrink-0 rounded-md bg-red-600 px-3 py-1.5 font-medium hover:bg-red-500
                focus-visible:outline-2 focus-visible:outline-white"
              onclick={() => void restartApp()}
            >
              {t("Restart now")}
            </button>
          </div>
        {/if}
        <label class="flex items-center justify-between gap-4 py-3">
          <span class="min-w-0">
            <span class="block font-medium">{t("Language")}</span>
            <span class="block text-neutral-400">{t("Of this window, the tray menu and what the app adds to the page.")}</span>
          </span>
          <select
            class="w-44 shrink-0 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5
              text-neutral-100 focus-visible:outline-2 focus-visible:outline-white"
            value={settings.language}
            onchange={(event) => update({ language: event.currentTarget.value })}
          >
            <option value="system">{t("Same as Windows")}</option>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </label>
      </div>
    </section>

    <section class="mt-6">
      <h2 class="mb-1 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        {t("Global shortcuts")}
      </h2>
      <div class="divide-y divide-neutral-800 rounded-lg bg-neutral-900 px-4">
        {#each SHORTCUT_ACTIONS as action (action)}
          <ShortcutField
            {t}
            label={shortcutLabel(action)}
            value={settings.shortcuts[action]}
            onchange={(shortcut) => setShortcut(action, shortcut)}
          />
        {/each}
      </div>
      <p class="mt-2 text-neutral-400">
        {t(
          "These work while another program has the focus, and take the keys away from it. Click a field and press the combination.",
        )}
      </p>
    </section>

    <section class="mt-6">
      <h2 class="mb-1 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        {t("Plugins")}
      </h2>
      <input
        type="search"
        class="mb-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-neutral-100
          placeholder:text-neutral-500 focus-visible:outline-2 focus-visible:outline-white"
        placeholder={t("Search plugins")}
        aria-label={t("Search plugins")}
        bind:value={search}
      />
      {#each groups as group (group.category)}
      <h3 class="mt-3 mb-1 text-xs text-neutral-400">{t(CATEGORY_LABELS[group.category])}</h3>
      <div class="divide-y divide-neutral-800 rounded-lg bg-neutral-900 px-4">
        {#each group.plugins as { manifest, external } (manifest.name)}
          <div>
            <Toggle
              checked={settings.plugins.includes(manifest.name)}
              onchange={(enabled) => setPluginEnabled(manifest.name, enabled)}
            >
              <span class="block font-medium">
                {manifest.name}
                <span class="font-normal text-neutral-500">{manifest.version}</span>
                {#if external}
                  <span
                    class="ml-1 rounded border border-neutral-600 px-1.5 py-0.5 text-xs font-normal text-neutral-300"
                  >
                    {t("external")}
                  </span>
                {/if}
              </span>
              {#if manifest.description}
                <span class="block text-neutral-300">{t(manifest.description)}</span>
              {/if}
              <span class="block text-neutral-400">
                {manifest.permissions.length > 0
                  ? t("Permissions: {list}", { list: manifest.permissions.join(", ") })
                  : t("No permissions")}
              </span>
              {#if manifest.hosts?.length}
                <span class="block text-neutral-400">
                  {t("Contacts: {hosts}", { hosts: manifest.hosts.join(", ") })}
                </span>
              {/if}
              {#if rivalsOf(manifest.name).length > 0}
                <span class="block text-neutral-400">
                  {t("Not together with: {names}", { names: rivalsOf(manifest.name).join(", ") })}
                </span>
              {/if}
            </Toggle>
            {#if Object.values(manifest.settings ?? {}).some((field) => !field.hidden)}
              <PluginSettings
                {t}
                schema={manifest.settings ?? {}}
                values={resolveSettings(manifest, settings.pluginSettings[manifest.name])}
                onchange={(key, value) => setPluginSetting(manifest.name, key, value)}
                onreset={() => resetPluginSettings(manifest.name)}
              />
            {/if}
            {#if external}
              <div class="flex justify-end pb-2">
                <button
                  type="button"
                  class="rounded-md border px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-white
                    {removing === manifest.name
                    ? 'border-red-700 bg-red-950 text-red-100 hover:bg-red-900'
                    : 'border-neutral-700 hover:bg-neutral-800'}"
                  onclick={() => void remove(manifest.name)}
                  onblur={() => (removing = null)}
                >
                  {removing === manifest.name ? t("Really remove? Its files are deleted.") : t("Remove")}
                </button>
              </div>
            {/if}
            {#each health.pluginErrors[manifest.name] ?? [] as message, index (index)}
              <p class="pb-2 text-red-300">{t("Error: {message}", { message })}</p>
            {/each}
          </div>
        {/each}
      </div>
      {:else}
        <p class="rounded-lg bg-neutral-900 px-4 py-3 text-neutral-400">
          {plugins.length === 0 ? t("No plugins installed.") : t("No plugin matches the search.")}
        </p>
      {/each}

      {#if notice}
        <p role="status" class="mt-2 text-amber-300">{notice}</p>
      {/if}
      {#each rejected as reason (reason)}
        <p class="mt-2 text-amber-300">{t("Ignored plugin folder {reason}", { reason })}</p>
      {/each}

      <p class="mt-3 text-neutral-400">
        {t("External plugins run in a sandbox. Reload after adding or editing one.")}
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        {@render action(t("Install from a zip file"), () => void installFromZip())}
        {@render action(t("Open plugins folder"), showPluginsFolder)}
        {@render action(t("Reload plugins"), () => void reload())}
      </div>
      <div class="mt-2 rounded-lg bg-neutral-900 px-4">
        <Toggle
          checked={settings.reloadPluginsOnChange}
          onchange={(reloadPluginsOnChange) => update({ reloadPluginsOnChange })}
        >
          <span class="block font-medium">{t("Reload when files change")}</span>
          <span class="block text-neutral-400">
            {t("For plugin authors: external plugins start again as soon as a file in the plugins folder changes.")}
          </span>
        </Toggle>
      </div>
    </section>

    <section class="mt-6">
      <h2 class="mb-1 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        {t("Backup and log")}
      </h2>
      <p class="text-neutral-400">
        {t(
          "Export writes all settings, including those of the plugins, to a file. Import replaces the current settings with those from a file.",
        )}
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        {@render action(t("Export settings"), () => void exportToFile())}
        {@render action(t("Import settings"), () => void importFromFile())}
        {@render action(t("Open log"), showLog)}
      </div>
      {#if backupNotice}
        <p role="status" class="mt-2 text-neutral-300">{backupNotice}</p>
      {/if}
    </section>
  {/if}
</main>

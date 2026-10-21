import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../shared/types";
import App from "./App.svelte";

const client = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  updatePluginSettings: vi.fn(),
  listExternalPlugins: vi.fn(),
  restartRequired: vi.fn(),
  restartApp: vi.fn(),
  reloadPlugins: vi.fn(),
  openPluginsFolder: vi.fn(),
  openLog: vi.fn(),
  exportSettings: vi.fn(),
  getHealth: vi.fn(),
  isFirstRun: vi.fn(),
  importSettings: vi.fn(),
  installPlugin: vi.fn(),
  removePlugin: vi.fn(),
  appVersion: vi.fn(),
  portableFolder: vi.fn(),
  pendingUpdate: vi.fn(),
  checkUpdate: vi.fn(),
  installUpdate: vi.fn(),
  marketplaceList: vi.fn(),
  marketplaceInstall: vi.fn(),
  marketplaceOpenHomepage: vi.fn(),
  openRepository: vi.fn(() => Promise.resolve()),
}));
/** The first tab's panel, with the plugins. */
const pluginsTab = (): HTMLElement => document.querySelector<HTMLElement>("[role=tabpanel]")!;

const setTitle = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("../core/settings/client", () => client);
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTitle }) }));

const settings = (changes: Partial<Settings> = {}): Settings => ({
  plugins: ["track-fade"],
  startup: false,
  startInTray: false,
  minimizeToTray: true,
  resumePlayback: true,
  language: "en",
  reloadPluginsOnChange: false,
  hardwareAcceleration: true,
  checkForUpdates: true,
  betaUpdates: false,
  alwaysOnTop: false,
  zoom: 100,
  outputDevice: "",
  unloadAfterMinutes: 0,
  pluginSettings: {},
  shortcuts: { playPause: "", next: "", previous: "", volumeUp: "", volumeDown: "", toggleMute: "" },
  windowShortcuts: { like: "", dislike: "" },
  ...changes,
});

/** The switch in the row that carries `label`. */
const switchFor = (label: string): HTMLInputElement => {
  const row = screen.getByText(label).closest("label");
  const input = row?.querySelector<HTMLInputElement>('input[role="switch"]');
  if (!input) throw new Error(`no switch for ${label}`);
  return input;
};
/** The settings as the backend has them after the window's last change. */
let saved: Settings = settings();
const lastSaved = (): Settings => saved;

beforeEach(() => {
  vi.clearAllMocks();
  saved = settings();
  client.getSettings.mockImplementation(() => Promise.resolve(saved));
  // Like the backend: merges the change into what it has and answers with the result.
  client.updateSettings.mockImplementation((changes: Partial<Settings>) => {
    saved = { ...saved, ...changes };
    return Promise.resolve(saved);
  });
  client.updatePluginSettings.mockImplementation(
    (plugin: string, values: Record<string, unknown>, replace: boolean) => {
      const current = replace ? {} : (saved.pluginSettings[plugin] ?? {});
      saved = { ...saved, pluginSettings: { ...saved.pluginSettings, [plugin]: { ...current, ...values } } } as Settings;
      return Promise.resolve(saved);
    },
  );
  client.listExternalPlugins.mockResolvedValue([]);
  client.restartRequired.mockResolvedValue(false);
  client.exportSettings.mockResolvedValue(true);
  client.importSettings.mockResolvedValue(null);
  client.openLog.mockResolvedValue(undefined);
  client.getHealth.mockResolvedValue({ pageProblems: [], pluginErrors: {} });
  client.isFirstRun.mockResolvedValue(false);
  client.appVersion.mockResolvedValue("1.0.0");
  client.portableFolder.mockResolvedValue(null);
  client.pendingUpdate.mockResolvedValue(null);
});

describe("settings window", () => {
  it("shows the settings and saves a switch at once", async () => {
    render(App);
    await screen.findByText("General");
    expect(switchFor("Minimize to tray").checked).toBe(true);
    expect(switchFor("Start in the tray").checked).toBe(false);

    await fireEvent.click(switchFor("Start in the tray"));

    await waitFor(() => expect(client.updateSettings).toHaveBeenCalledExactlyOnceWith({ startInTray: true }));
    expect(lastSaved()).toEqual(settings({ startInTray: true }));
    expect(switchFor("Start in the tray").checked).toBe(true);
  });

  it("flips a switch back and says why when saving fails", async () => {
    client.updateSettings.mockRejectedValue("too many plugins");
    render(App);
    await screen.findByText("General");

    await fireEvent.click(switchFor("Resume the last track"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not save settings: too many plugins");
    expect(switchFor("Resume the last track").checked).toBe(true);
  });

  it("switches to German with the language setting", async () => {
    render(App);
    await screen.findByText("General");
    expect(setTitle).toHaveBeenLastCalledWith("Settings");

    await fireEvent.click(screen.getByRole("tab", { name: "General" }));
    await fireEvent.click(screen.getByRole("combobox", { name: "Language" }));
    await fireEvent.mouseDown(screen.getByRole("option", { name: "Deutsch" }));

    await screen.findByText("Allgemein");
    expect(screen.getByText("Letzten Titel wieder laden")).toBeTruthy();
    expect(screen.queryByText("General")).toBeNull();
    expect(lastSaved().language).toBe("de");
    expect(document.documentElement.lang).toBe("de");
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith("Einstellungen"));
  });

  it("sets the page's zoom", async () => {
    render(App);
    await fireEvent.click(await screen.findByRole("tab", { name: "General" }));
    await fireEvent.click(screen.getByRole("combobox", { name: "Zoom" }));
    await fireEvent.mouseDown(screen.getByRole("option", { name: "125 %" }));
    expect(lastSaved().zoom).toBe(125);
  });

  it("opens the project's page from About", async () => {
    render(App);
    await fireEvent.click(await screen.findByRole("tab", { name: "About" }));
    await fireEvent.click(screen.getByRole("button", { name: "Open the project on GitHub" }));
    expect(client.openRepository).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Portable/)).toBeNull();
  });

  it("says under About where a portable copy keeps everything", async () => {
    client.portableFolder.mockResolvedValue("/opt/ytmusic/ytmusic-desktop-data");
    render(App);
    await fireEvent.click(await screen.findByRole("tab", { name: "About" }));
    expect(
      await screen.findByText("Portable: settings, plugins and login are kept in /opt/ytmusic/ytmusic-desktop-data"),
    ).toBeTruthy();
  });

  it("follows the system language when the setting says so", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("de-DE");
    client.getSettings.mockResolvedValue(settings({ language: "system" }));
    render(App);
    await screen.findByText("Allgemein");
    vi.restoreAllMocks();
  });

  it("switches off a plugin that cannot run together with the one switched on", async () => {
    render(App);
    await screen.findByText("General");
    const crossfade = screen.getByText("crossfade").closest("label")?.querySelector<HTMLInputElement>('input[role="switch"]');
    if (!crossfade) throw new Error("no crossfade switch");

    await fireEvent.click(crossfade);

    await waitFor(() => expect(client.updateSettings).toHaveBeenCalledOnce());
    expect(lastSaved().plugins).toEqual(["crossfade"]);
    expect(await screen.findByText("Switched off track-fade, which cannot run together with crossfade.")).toBeTruthy();
  });

  it("offers a restart when a setting needs one", async () => {
    client.restartRequired.mockResolvedValue(true);
    render(App);
    await fireEvent.click(await screen.findByText("Restart now"));
    expect(client.restartApp).toHaveBeenCalledOnce();
  });

  it("shows imported settings and says so", async () => {
    client.importSettings.mockResolvedValue(settings({ minimizeToTray: false, language: "de" }));
    render(App);
    await fireEvent.click(await screen.findByText("Import settings"));

    expect(await screen.findByText("Einstellungen importiert.")).toBeTruthy();
    expect(switchFor("In den Tray minimieren").checked).toBe(false);
    // The backend saved them already; the window must not save them again.
    expect(client.updateSettings).not.toHaveBeenCalled();
    expect(client.updatePluginSettings).not.toHaveBeenCalled();
  });

  it("says nothing when a file dialog was cancelled, and reports a refused file", async () => {
    client.exportSettings.mockResolvedValue(false);
    render(App);
    await fireEvent.click(await screen.findByText("Export settings"));
    await waitFor(() => expect(client.exportSettings).toHaveBeenCalledOnce());
    expect(screen.queryByText("Settings exported.")).toBeNull();

    client.importSettings.mockRejectedValue("not a settings file");
    await fireEvent.click(screen.getByText("Import settings"));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not import the settings: not a settings file");
  });

  it("lists plugins by kind, with what they do, and filters them", async () => {
    render(App);
    await screen.findByText("General");
    const headings = [...pluginsTab().querySelectorAll("h3")].map((heading) => heading.textContent?.trim());
    expect(headings).toEqual(["Sound", "Appearance", "Playback", "Tools", "Plugins from others", "Find plugins"]);
    expect(screen.getByText("Brings every track to the same loudness.")).toBeTruthy();

    await fireEvent.input(screen.getByLabelText("Search plugins"), { target: { value: "loud" } });
    await waitFor(() => expect(screen.queryByText("crossfade")).toBeNull());
    expect(screen.getByText("normalize")).toBeTruthy();
    expect(screen.getByText("track-info")).toBeTruthy();

    await fireEvent.input(screen.getByLabelText("Search plugins"), { target: { value: "no such plugin" } });
    expect(await screen.findByText("No plugin matches the search.")).toBeTruthy();
  });

  it("shows one tab at a time, the plugins first", async () => {
    client.pendingUpdate.mockResolvedValue({ version: "1.1.0", notes: "", byHand: false });
    render(App);
    const panelOf = (text: string): HTMLElement | null => screen.getByText(text).closest<HTMLElement>("[role=tabpanel]");
    await screen.findByText("General");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual([
      "Plugins",
      "General",
      "Shortcuts",
      "Updates",
      "Backup",
      "About",
    ]);
    expect(panelOf("Plugins from others")?.hidden).toBe(false);
    expect(panelOf("Start at sign-in")?.hidden).toBe(true);
    // An update that waits is marked on its tab.
    expect(screen.getByRole("tab", { name: /Updates/ }).querySelector("[title='Version 1.1.0 is available.']")).toBeTruthy();

    await fireEvent.click(screen.getByRole("tab", { name: "General" }));
    expect(panelOf("Start at sign-in")?.hidden).toBe(false);
    expect(panelOf("Plugins from others")?.hidden).toBe(true);
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    await fireEvent.click(screen.getByRole("tab", { name: "Backup" }));
    expect(panelOf("Export settings")?.hidden).toBe(false);
    expect(panelOf("Start at sign-in")?.hidden).toBe(true);
  });

  it("loads the plugin list only when asked, and installs from it", async () => {
    const entry = {
      name: "hello",
      version: "1.0.0",
      description: "Says hello.",
      author: "someone",
      homepage: "https://example.org/hello",
      permissions: ["music.read", "network"],
      hosts: ["api.example.org"],
      url: "https://example.org/hello.zip",
      sha256: "a".repeat(64),
    };
    client.marketplaceList.mockResolvedValue([entry]);
    client.marketplaceInstall.mockResolvedValue("hello");
    render(App);
    await screen.findByText("General");
    expect(client.marketplaceList).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "Load the list" }));
    await screen.findByText("Says hello.");
    expect(screen.getByText("Permissions: music.read, network", { exact: false })).toBeTruthy();
    expect(screen.getByText("Contacts: api.example.org", { exact: false })).toBeTruthy();

    await fireEvent.click(screen.getByRole("button", { name: "More about it" }));
    expect(client.marketplaceOpenHomepage).toHaveBeenCalledWith("hello");

    // Once installed, the list knows it.
    client.listExternalPlugins.mockResolvedValue([
      { name: "hello", manifest: { name: "hello", version: "1.0.0", permissions: ["music.read", "network"], hosts: ["api.example.org"] }, frameUrl: "x" },
    ]);
    await fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(client.marketplaceInstall).toHaveBeenCalledWith("hello");
    expect(await screen.findByText("Installed hello. Switch it on in the list above.")).toBeTruthy();
    const installed = await screen.findByRole("button", { name: "Installed" });
    expect((installed as HTMLButtonElement).disabled).toBe(true);

    // Loading again asks again.
    await fireEvent.click(screen.getByRole("button", { name: "Load again" }));
    await waitFor(() => expect(client.marketplaceList).toHaveBeenCalledTimes(2));
  });

  it("offers an update for an installed plugin the list has newer", async () => {
    client.listExternalPlugins.mockResolvedValue([
      { name: "hello", manifest: { name: "hello", version: "0.9.0", permissions: [] }, frameUrl: "x" },
    ]);
    client.marketplaceList.mockResolvedValue([
      { name: "hello", version: "1.0.0", description: "Says hello.", author: "someone", homepage: null, permissions: [], hosts: [], url: "https://example.org/hello.zip", sha256: "a".repeat(64) },
    ]);
    render(App);
    await screen.findByText("General");
    await fireEvent.click(screen.getByRole("button", { name: "Load the list" }));
    const update = await screen.findByRole("button", { name: "Update to 1.0.0" });
    expect(screen.queryByRole("button", { name: "More about it" })).toBeNull();

    client.marketplaceInstall.mockResolvedValue("hello");
    client.listExternalPlugins.mockResolvedValue([
      { name: "hello", manifest: { name: "hello", version: "1.0.0", permissions: [] }, frameUrl: "x" },
    ]);
    await fireEvent.click(update);
    expect(await screen.findByText("Updated hello to 1.0.0.")).toBeTruthy();
  });

  it("says why the list could not be loaded", async () => {
    client.marketplaceList.mockRejectedValue("cannot reach raw.githubusercontent.com");
    render(App);
    await screen.findByText("General");
    await fireEvent.click(screen.getByRole("button", { name: "Load the list" }));
    expect(await screen.findByText("Could not load the list: cannot reach raw.githubusercontent.com")).toBeTruthy();
  });

  it("sets the window's shortcuts, also those of plugins", async () => {
    client.getSettings.mockResolvedValue(settings({ plugins: ["equalizer"] }));
    render(App);
    await screen.findByText("General");
    await fireEvent.click(screen.getByRole("tab", { name: "Shortcuts" }));
    const record = async (label: string, init: KeyboardEventInit): Promise<HTMLElement> => {
      const field = screen.getByRole("button", { name: `${label} shortcut` });
      await fireEvent.click(field);
      await fireEvent.keyDown(field, init);
      return field;
    };

    await record("Like", { code: "KeyL", ctrlKey: true, shiftKey: true });
    expect(client.updateSettings).toHaveBeenCalledWith({ windowShortcuts: { like: "Ctrl+Shift+KeyL", dislike: "" } });

    await record("Equalizer", { code: "KeyE", ctrlKey: true, shiftKey: true });
    expect(client.updatePluginSettings).toHaveBeenCalledWith("equalizer", { shortcut: "Ctrl+Shift+KeyE" }, false);
    // A plugin that is off says when its shortcut works.
    expect(screen.getByText("Opens and closes its panel, while the plugin themes is on.")).toBeTruthy();

    // What the window keeps is refused here too.
    const dislike = await record("Dislike", { code: "KeyC", ctrlKey: true });
    expect(dislike.textContent).toContain("is taken by the app");
  });

  it("filters the plugins by kind and by what is switched on", async () => {
    client.getSettings.mockResolvedValue(settings({ plugins: ["lyrics", "normalize"] }));
    render(App);
    await screen.findByText("General");
    const kinds = (): (string | undefined)[] =>
      [...pluginsTab().querySelectorAll("h3")].map((heading) => heading.textContent?.trim()).slice(0, -2);

    await fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(kinds()).toEqual(["Appearance"]);
    expect(screen.queryByText("normalize")).toBeNull();
    expect(screen.getByText("themes")).toBeTruthy();

    await fireEvent.click(screen.getByRole("button", { name: "Switched on (2)" }));
    expect(kinds()).toEqual(["Sound", "Tools"]);
    expect(screen.queryByText("themes")).toBeNull();
    // Switching one off updates the count. It stays in the list, to be
    // switched on again, until the filter is chosen anew.
    await fireEvent.click(switchFor("normalize"));
    const on = await screen.findByRole("button", { name: "Switched on (1)" });
    expect(screen.getByText("normalize")).toBeTruthy();
    await fireEvent.click(on);
    expect(screen.queryByText("normalize")).toBeNull();
    expect(kinds()).toEqual(["Tools"]);

    await fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(kinds()).toEqual(["Sound", "Appearance", "Playback", "Tools"]);
  });

  it("keeps a plugin's details and settings folded away until asked for", async () => {
    render(App);
    await screen.findByText("General");
    const row = screen.getByText("lyrics").closest("label")?.parentElement as HTMLElement;
    const details = row.querySelector<HTMLElement>(":scope > div");
    const unfold = row.querySelector<HTMLButtonElement>(":scope > button");
    expect(unfold?.textContent).toContain("Settings and details");
    expect(details?.hidden).toBe(true);

    await fireEvent.click(unfold as HTMLButtonElement);
    expect(details?.hidden).toBe(false);
    expect(unfold?.getAttribute("aria-expanded")).toBe("true");
    expect(details?.textContent).toContain("Permissions: music.read");
    expect(details?.textContent).toContain("Contacts: lrclib.net");
    await fireEvent.click(unfold as HTMLButtonElement);
    expect(details?.hidden).toBe(true);

    // A plugin without settings still has details.
    const plain = screen.getByText("prefer-opus").closest("label")?.parentElement as HTMLElement;
    expect(plain.querySelector(":scope > button")?.textContent).toContain("Details");
    expect(plain.querySelector(":scope > button")?.textContent).not.toContain("Settings");
  });

  it("resets what it shows of a plugin's settings and keeps what the plugin stores for itself", async () => {
    saved = settings({ pluginSettings: { lyrics: { fontSize: 22, offsets: '{"dQw4w9WgXcQ":1}' }, themes: { blur: 10 } } });
    render(App);
    await screen.findByText("General");
    const block = screen.getByText("Font size").closest("div");
    const reset = [...(block?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.trim() === "Reset to defaults");
    if (!reset) throw new Error("no reset button");
    expect(reset.disabled).toBe(false);

    await fireEvent.click(reset);

    await waitFor(() => expect(client.updatePluginSettings).toHaveBeenCalledOnce());
    expect(lastSaved().pluginSettings).toEqual({ lyrics: { offsets: '{"dQw4w9WgXcQ":1}' }, themes: { blur: 10 } });
  });

  it("shows what does not work", async () => {
    client.getHealth.mockResolvedValue({
      pageProblems: ["volumeSlider", "player.seekTo"],
      pluginErrors: { lyrics: ["failed in onSongChange and was switched off: boom"] },
    });
    render(App);
    const alert = await screen.findByText("YouTube Music has changed");
    expect(alert.parentElement?.textContent).toContain("the volume slider, the player's function seekTo");
    expect(await screen.findByText("Error: failed in onSongChange and was switched off: boom")).toBeTruthy();
  });

  it("welcomes on the first start only", async () => {
    client.isFirstRun.mockResolvedValue(true);
    const first = render(App);
    expect(await screen.findByText("Welcome!")).toBeTruthy();
    first.unmount();
    client.isFirstRun.mockResolvedValue(false);
    render(App);
    await screen.findByText("General");
    expect(screen.queryByText("Welcome!")).toBeNull();
  });

  it("shows the version and what a check finds", async () => {
    client.checkUpdate.mockResolvedValue(null);
    render(App);
    expect(await screen.findByText("Installed: version 1.0.0")).toBeTruthy();
    expect(screen.queryByText("Install and restart")).toBeNull();
    await fireEvent.click(screen.getByText("Look now"));
    expect(await screen.findByText("This is the newest version.")).toBeTruthy();

    client.checkUpdate.mockResolvedValue({ version: "1.1.0", notes: "- Something new", byHand: false });
    await fireEvent.click(screen.getByText("Look now"));
    expect(await screen.findByText("Version 1.1.0 is available.")).toBeTruthy();
    expect(screen.getByText("- Something new")).toBeTruthy();
    expect(screen.queryByText("This is the newest version.")).toBeNull();
  });

  it("offers the update found at start and installs it on a click only", async () => {
    client.pendingUpdate.mockResolvedValue({ version: "1.1.0", notes: "", byHand: false });
    client.installUpdate.mockRejectedValue("signature does not fit");
    render(App);
    const install = await screen.findByText("Install and restart");
    expect(client.installUpdate).not.toHaveBeenCalled();
    await fireEvent.click(install);
    expect(client.installUpdate).toHaveBeenCalledOnce();
    expect(await screen.findByText("Could not install the update: signature does not fit")).toBeTruthy();
  });

  it("sends a portable copy to the download page", async () => {
    client.pendingUpdate.mockResolvedValue({ version: "1.1.0", notes: "", byHand: true });
    client.installUpdate.mockResolvedValue(undefined);
    render(App);
    await fireEvent.click(await screen.findByText("Open the download page"));
    expect(client.installUpdate).toHaveBeenCalledOnce();
    expect(
      await screen.findByText("The download page is open in your browser. A copy from the zip is replaced by unpacking the new one over it; a package for Linux is updated by your package manager."),
    ).toBeTruthy();
    expect(screen.queryByText("Install and restart")).toBeNull();
  });

  it("says so when the check fails, and saves the switch", async () => {
    client.checkUpdate.mockRejectedValue("no connection");
    render(App);
    await fireEvent.click(await screen.findByText("Look now"));
    expect(await screen.findByText("Could not check for updates: no connection")).toBeTruthy();
    await fireEvent.click(screen.getByRole("tab", { name: "Updates" }));
    await fireEvent.click(screen.getByRole("switch", { name: /Look for updates at start/ }));
    expect(client.updateSettings).toHaveBeenLastCalledWith({ checkForUpdates: false });
  });

  it("offers test versions only when asked to", async () => {
    render(App);
    await fireEvent.click(await screen.findByRole("tab", { name: "Updates" }));
    const betas = screen.getByRole<HTMLInputElement>("switch", { name: /Also offer test versions/ });
    expect(betas.checked).toBe(false);
    await fireEvent.click(betas);
    expect(client.updateSettings).toHaveBeenLastCalledWith({ betaUpdates: true });
  });

  it("says so when the settings cannot be loaded", async () => {
    client.getSettings.mockRejectedValue("backend gone");
    render(App);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load settings: backend gone");
    expect(screen.queryByText("General")).toBeNull();
  });
});

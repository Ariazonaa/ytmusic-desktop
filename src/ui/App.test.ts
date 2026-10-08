import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../shared/types";
import App from "./App.svelte";

const client = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
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
}));
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
  pluginSettings: {},
  shortcuts: { playPause: "", next: "", previous: "", volumeUp: "", volumeDown: "", toggleMute: "" },
  ...changes,
});

/** The switch in the row that carries `label`. */
const switchFor = (label: string): HTMLInputElement => {
  const row = screen.getByText(label).closest("label");
  const input = row?.querySelector<HTMLInputElement>('input[role="switch"]');
  if (!input) throw new Error(`no switch for ${label}`);
  return input;
};
const lastSaved = (): Settings => client.setSettings.mock.calls.at(-1)?.[0] as Settings;

beforeEach(() => {
  vi.clearAllMocks();
  client.getSettings.mockResolvedValue(settings());
  client.setSettings.mockResolvedValue(undefined);
  client.listExternalPlugins.mockResolvedValue([]);
  client.restartRequired.mockResolvedValue(false);
  client.exportSettings.mockResolvedValue(true);
  client.importSettings.mockResolvedValue(null);
  client.openLog.mockResolvedValue(undefined);
  client.getHealth.mockResolvedValue({ pageProblems: [], pluginErrors: {} });
  client.isFirstRun.mockResolvedValue(false);
});

describe("settings window", () => {
  it("shows the settings and saves a switch at once", async () => {
    render(App);
    await screen.findByText("General");
    expect(switchFor("Minimize to tray").checked).toBe(true);
    expect(switchFor("Start in the tray").checked).toBe(false);

    await fireEvent.click(switchFor("Start in the tray"));

    await waitFor(() => expect(client.setSettings).toHaveBeenCalledOnce());
    expect(lastSaved()).toEqual(settings({ startInTray: true }));
    expect(switchFor("Start in the tray").checked).toBe(true);
  });

  it("flips a switch back and says why when saving fails", async () => {
    client.setSettings.mockRejectedValue("too many plugins");
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

    const language = screen.getByText("Language").closest("label")?.querySelector("select");
    if (!language) throw new Error("no language field");
    await fireEvent.change(language, { target: { value: "de" } });

    await screen.findByText("Allgemein");
    expect(screen.getByText("Letzten Titel wieder laden")).toBeTruthy();
    expect(screen.queryByText("General")).toBeNull();
    expect(lastSaved().language).toBe("de");
    expect(document.documentElement.lang).toBe("de");
    await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith("Einstellungen"));
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

    await waitFor(() => expect(client.setSettings).toHaveBeenCalledOnce());
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
    expect(client.setSettings).not.toHaveBeenCalled();
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
    const headings = [...document.querySelectorAll("h3")].map((heading) => heading.textContent?.trim());
    expect(headings).toEqual(["Sound", "Appearance", "Playback", "Tools"]);
    expect(screen.getByText("Brings every track to the same loudness.")).toBeTruthy();

    await fireEvent.input(screen.getByLabelText("Search plugins"), { target: { value: "loud" } });
    await waitFor(() => expect(screen.queryByText("crossfade")).toBeNull());
    expect(screen.getByText("normalize")).toBeTruthy();
    expect(screen.getByText("track-info")).toBeTruthy();

    await fireEvent.input(screen.getByLabelText("Search plugins"), { target: { value: "no such plugin" } });
    expect(await screen.findByText("No plugin matches the search.")).toBeTruthy();
  });

  it("resets what it shows of a plugin's settings and keeps what the plugin stores for itself", async () => {
    client.getSettings.mockResolvedValue(
      settings({ pluginSettings: { lyrics: { fontSize: 22, offsets: '{"dQw4w9WgXcQ":1}' }, themes: { blur: 10 } } }),
    );
    render(App);
    await screen.findByText("General");
    const block = screen.getByText("Font size").closest("div");
    const reset = [...(block?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.trim() === "Reset to defaults");
    if (!reset) throw new Error("no reset button");
    expect(reset.disabled).toBe(false);

    await fireEvent.click(reset);

    await waitFor(() => expect(client.setSettings).toHaveBeenCalledOnce());
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

  it("says so when the settings cannot be loaded", async () => {
    client.getSettings.mockRejectedValue("backend gone");
    render(App);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load settings: backend gone");
    expect(screen.queryByText("General")).toBeNull();
  });
});

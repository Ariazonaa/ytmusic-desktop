import { afterEach, expect, it, vi } from "vitest";
import { setLanguage } from "../i18n";
import { showNotice } from "./notice";
import { showUpdateNotice } from "./update-notice";

vi.mock("./notice", () => ({ showNotice: vi.fn() }));

afterEach(() => {
  setLanguage("en");
  vi.clearAllMocks();
});

it("names the version and leads to the settings window", () => {
  const openSettings = vi.fn();
  showUpdateNotice("1.2.3", openSettings);
  const [text, action] = vi.mocked(showNotice).mock.calls[0] ?? [];
  expect(text).toBe("Version 1.2.3 of the app is available");
  expect(action?.label).toBe("Show");
  action?.onClick();
  expect(openSettings).toHaveBeenCalledOnce();
});

it("speaks German when the app does", () => {
  setLanguage("de");
  showUpdateNotice("1.2.3", () => {});
  const [text, action] = vi.mocked(showNotice).mock.calls[0] ?? [];
  expect(text).toBe("Version 1.2.3 der App ist verfügbar");
  expect(action?.label).toBe("Anzeigen");
});

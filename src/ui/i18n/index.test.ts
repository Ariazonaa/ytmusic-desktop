import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../shared/types";
import de from "./de";
import { resolveLanguage, translator } from "./index";

const manifests = import.meta.glob<PluginManifest>("../../plugins/*/plugin.json", { eager: true, import: "default" });
const components = import.meta.glob<string>("../*.svelte", { eager: true, query: "?raw", import: "default" });

describe("resolveLanguage", () => {
  it("follows the setting", () => {
    expect(resolveLanguage("de", "en-US")).toBe("de");
    expect(resolveLanguage("en", "de-DE")).toBe("en");
  });

  it("follows the system otherwise", () => {
    expect(resolveLanguage("system", "de-AT")).toBe("de");
    expect(resolveLanguage("system", "DE")).toBe("de");
    expect(resolveLanguage("system", "fr-FR")).toBe("en");
    expect(resolveLanguage("nonsense", "de")).toBe("de");
  });
});

describe("translator", () => {
  it("leaves English as it is", () => {
    const t = translator("en");
    expect(t("Restart now")).toBe("Restart now");
    expect(t("Permissions: {list}", { list: "audio" })).toBe("Permissions: audio");
  });

  it("translates and fills placeholders", () => {
    const t = translator("de");
    expect(t("Restart now")).toBe("Jetzt neu starten");
    expect(t("Permissions: {list}", { list: "audio" })).toBe("Rechte: audio");
    expect(t("Switched off {names}, which cannot run together with {name}.", { names: "a", name: "b" })).toBe(
      "a ausgeschaltet, weil es nicht zusammen mit b laufen kann.",
    );
  });

  it("keeps texts it does not know, and placeholders without a value", () => {
    const t = translator("de");
    expect(t("A label from an external plugin")).toBe("A label from an external plugin");
    expect(t("Contacts: {hosts}", {})).toBe("Verbindet sich mit: {hosts}");
  });
});

describe("German texts", () => {
  it("keep the placeholders of the English text", () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{\w+\}/g)].map(([match]) => match).sort();
    for (const [english, german] of Object.entries(de)) {
      expect(placeholders(german), english).toEqual(placeholders(english));
    }
  });

  it("cover every text the built-in plugins show in the settings window", () => {
    const missing: string[] = [];
    expect(Object.keys(manifests).length).toBeGreaterThan(10);
    for (const manifest of Object.values(manifests)) {
      const folder = manifest.name;
      if (manifest.description === undefined) missing.push(`${folder}: no description`);
      else if (!(manifest.description in de)) missing.push(`${folder}: ${manifest.description}`);
      for (const field of Object.values(manifest.settings ?? {})) {
        if (field.hidden) continue;
        const texts = [field.label, field.description, "unit" in field ? field.unit : undefined];
        if (field.type === "select") texts.push(...field.options.map((option) => option.label));
        for (const text of texts) {
          if (text !== undefined && !(text in de)) missing.push(`${folder}: ${text}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("cover every text of the settings window itself", () => {
    const used = Object.values(components).flatMap((source) =>
      [...source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)+)"/g)].map(([, text]) => JSON.parse(`"${text}"`) as string),
    );
    expect(used.length).toBeGreaterThan(30);
    expect(used.filter((text) => !(text in de))).toEqual([]);
  });
});

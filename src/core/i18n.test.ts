import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_LABELS } from "../plugins/equalizer/ui";
import { CATEGORY_LABELS } from "../plugins/sponsorblock/segments";
import { BUILTIN_THEMES } from "../plugins/themes/builtin";
import { describeTrack } from "../plugins/track-info/info";
import { VALUE_WORDS } from "../plugins/track-info/index";
import { getLanguage, setLanguage, t } from "./i18n";
import de from "./i18n-de";

// Every source file that can show text in the page.
const sources = {
  ...import.meta.glob<string>("../plugins/**/*.ts", { eager: true, query: "?raw", import: "default" }),
  ...import.meta.glob<string>("./injector/*.ts", { eager: true, query: "?raw", import: "default" }),
};

afterEach(() => {
  setLanguage("en");
});

describe("language of the page", () => {
  it("is English unless German is chosen or the system is German", () => {
    setLanguage("system", "fr-FR");
    expect(getLanguage()).toBe("en");
    expect(t("Lyrics")).toBe("Lyrics");
    setLanguage("system", "de-AT");
    expect(getLanguage()).toBe("de");
    expect(t("Lyrics")).toBe("Songtext");
    setLanguage("en", "de-DE");
    expect(t("Lyrics")).toBe("Lyrics");
  });

  it("fills in values", () => {
    setLanguage("de");
    expect(t("Volume {volume} %", { volume: 40 })).toBe("Lautstärke 40 %");
    expect(t('Imported "{name}".', { name: "Sony" })).toBe("„Sony“ importiert.");
  });
});

describe("German texts for the page", () => {
  const literals = Object.entries(sources)
    .filter(([path]) => !path.endsWith(".test.ts"))
    .flatMap(([, source]) => [
      ...[...source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)+)"/g)].map(([, text]) => JSON.parse(`"${text}"`) as string),
      ...[...source.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)+)'/g)].map(([, text]) => (text as string).replace(/\\'/g, "'")),
    ]);
  // Texts that reach t() from a table rather than as a literal.
  const fromTables = [
    ...Object.values(BUILTIN_LABELS),
    ...Object.values(CATEGORY_LABELS),
    ...BUILTIN_THEMES.map((theme) => theme.name),
    ...VALUE_WORDS,
    ...describeTrack({
      videoId: "x",
      stats: { codecs: "0 / opus (251)", bandwidth_kbps: "1 Kbps", buffer_health_seconds: "1 s" },
      formats: [{ itag: 251, averageBitrate: 1, audioSampleRate: "48000", audioChannels: 2, audioQuality: "AUDIO_QUALITY_HIGH" }],
      loudnessLkfs: -14,
    }).map((row) => row.label),
  ];

  it("cover every text the plugins and the app's own buttons show", () => {
    expect(literals.length).toBeGreaterThan(60);
    const missing = [...new Set([...literals, ...fromTables])].filter((text) => !(text in de));
    expect(missing).toEqual([]);
  });

  it("keep the placeholders of the English text", () => {
    const placeholders = (text: string): string[] => [...text.matchAll(/\{\w+\}/g)].map(([match]) => match).sort();
    for (const [english, german] of Object.entries(de)) {
      expect(placeholders(german), english).toEqual(placeholders(english));
    }
  });

  it("have no entry nothing asks for", () => {
    const asked = new Set([...literals, ...fromTables]);
    expect(Object.keys(de).filter((text) => !asked.has(text))).toEqual([]);
  });
});

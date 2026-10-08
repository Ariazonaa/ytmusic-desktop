// What the settings window and the page's plugins share about languages.
// Each has its own table of texts; English texts are the keys, so a text
// without a translation simply stays English.

export type Language = "en" | "de";

/** The values of the `language` setting. `system` follows the operating system. */
export const LANGUAGE_SETTINGS = ["system", "en", "de"] as const;

/** The language to show for a `language` setting and the system's language tag, e.g. `de-AT`. */
export function resolveLanguage(setting: string, systemLanguage: string): Language {
  if (setting === "en" || setting === "de") return setting;
  return systemLanguage.toLowerCase().startsWith("de") ? "de" : "en";
}

/** Translates `text` and fills `{name}` placeholders from `values`. */
export type Translate = (text: string, values?: Record<string, string | number>) => string;

/** A translator for a table of texts by their English text. */
export function makeTranslator(table: Readonly<Record<string, string>>): Translate {
  return (text, values) => {
    const translated = table[text] ?? text;
    if (!values) return translated;
    return translated.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      name in values ? String(values[name]) : placeholder,
    );
  };
}

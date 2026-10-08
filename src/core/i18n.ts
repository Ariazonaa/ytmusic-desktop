// The language of what the app adds to the YouTube Music page: buttons,
// panels and notices of the built-in plugins. English texts are the keys.
import { makeTranslator, resolveLanguage, type Language, type Translate } from "../shared/i18n";
import de from "./i18n-de";

let language: Language = "en";
let translate: Translate = makeTranslator({});

/** The language texts are shown in. */
export function getLanguage(): Language {
  return language;
}

/**
 * Chooses the language from the `language` setting and the system's
 * language. What is already on the page keeps its language; plugins are
 * started again after a change so that they build their interface anew.
 */
export function setLanguage(setting: string, systemLanguage: string = navigator.language): void {
  language = resolveLanguage(setting, systemLanguage);
  translate = makeTranslator(language === "de" ? de : {});
}

/** Translates `text` into the chosen language and fills `{name}` placeholders from `values`. */
export const t: Translate = (text, values) => translate(text, values);

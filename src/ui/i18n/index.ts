// Translations for the settings window. English texts are the keys, so a
// text without a translation, such as one from an external plugin, simply
// stays English.
import { makeTranslator, type Language, type Translate } from "../../shared/i18n";
import de from "./de";

export { LANGUAGE_SETTINGS, resolveLanguage, type Language, type Translate } from "../../shared/i18n";

export function translator(language: Language): Translate {
  return makeTranslator(language === "de" ? de : {});
}

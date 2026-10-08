// The themes panel: saved theme files, and saving the current look as one.
import type { SharedFile } from "../../shared/types";
import { t } from "../../core/i18n";
import { BUILTIN_PREFIX } from "./builtin";

export const UI_CLASS = "ytmd-themes";

export const UI_CSS = `
.${UI_CLASS} { padding: 16px; overflow-y: auto; }
.${UI_CLASS} button, .${UI_CLASS} input {
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  background: #1c1c1c;
  color: #fff;
  font: inherit;
}
.${UI_CLASS} button { flex-shrink: 0; cursor: pointer; }
.${UI_CLASS}-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.${UI_CLASS}-row input { flex: 1; }
.${UI_CLASS} ul { margin: 0 0 16px; padding: 0; list-style: none; }
.${UI_CLASS} li { padding: 8px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
.${UI_CLASS} li span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${UI_CLASS} small { color: rgba(255, 255, 255, 0.6); font-size: 11px; }
.${UI_CLASS} p { margin: 0 0 12px; color: rgba(255, 255, 255, 0.7); }
.${UI_CLASS}-message { min-height: 18px; margin-top: 8px !important; font-size: 12px; }
.${UI_CLASS}-actions { margin-top: 16px; justify-content: flex-start; }
`;

export interface ThemesUi {
  /** Shows the theme files found in the themes folder. */
  setThemes(themes: readonly SharedFile[]): void;
  /** Shows a line of feedback under the save field. */
  setMessage(text: string): void;
}

interface Handlers {
  onApply(theme: SharedFile): void;
  onSave(name: string): void;
  onRefresh(): void;
  onOpenFolder(): void;
}

/** Builds the panel's content inside `container`. */
export function createThemesUi(container: HTMLElement, handlers: Handlers): ThemesUi {
  const doc = container.ownerDocument;
  // Trusted Types forbid innerHTML here: build everything by hand.
  const element = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, className = ""): HTMLElementTagNameMap[K] => {
    const created = parent.appendChild(doc.createElement(tag));
    if (className) created.className = className;
    return created;
  };
  const button = (parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement => {
    const created = element(parent, "button");
    created.type = "button";
    created.textContent = label;
    created.addEventListener("click", onClick);
    return created;
  };

  const root = element(container, "div", UI_CLASS);
  element(root, "p").textContent =
    t("A theme file holds the settings of this plugin. Colors, blur and layout are set in the settings window.");
  const list = element(root, "ul");

  const saveRow = element(root, "div", `${UI_CLASS}-row`);
  const name = element(saveRow, "input");
  name.type = "text";
  name.maxLength = 60;
  name.placeholder = t("Save the current look as…");
  name.setAttribute("aria-label", t("Theme name"));
  const save = (): void => handlers.onSave(name.value);
  button(saveRow, t("Save"), save);
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") save();
  });
  // Keeps YouTube Music's keyboard shortcuts from firing while typing a name.
  for (const type of ["keydown", "keyup", "keypress"]) {
    name.addEventListener(type, (event) => event.stopPropagation());
  }
  const message = element(root, "p", `${UI_CLASS}-message`);
  message.setAttribute("role", "status");

  const actions = element(root, "div", `${UI_CLASS}-row ${UI_CLASS}-actions`);
  button(actions, t("Open themes folder"), handlers.onOpenFolder);
  button(actions, t("Refresh"), handlers.onRefresh);

  return {
    setThemes(themes) {
      list.replaceChildren();
      if (themes.length === 0) {
        element(list, "li").textContent = t("No theme files yet.");
        return;
      }
      for (const theme of themes) {
        const item = element(list, "li", `${UI_CLASS}-row`);
        const label = element(item, "span");
        // The ready-made themes have names of the app's own, which are translated.
        label.textContent = theme.file.startsWith(BUILTIN_PREFIX) ? t(theme.name) : theme.name;
        const css = theme.settings.customCss;
        if (typeof css === "string" && css.trim() !== "") {
          // Custom CSS can change anything on the page, so it is pointed out.
          label.append(" ");
          element(label, "small").textContent = t("with custom CSS");
        }
        button(item, t("Apply"), () => handlers.onApply(theme));
      }
    },
    setMessage(text) {
      message.textContent = text;
      if (text.startsWith(t("Saved"))) name.value = "";
    },
  };
}

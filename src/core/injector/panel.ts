import type { Panel } from "../../shared/types";
import { injectCss } from "./css";
import { t } from "../i18n";

const PANEL_CLASS = "ytmd-panel";

// The panel sits at the right edge, between the navigation bar and the player bar.
const CSS = `
.${PANEL_CLASS} {
  position: fixed;
  top: 64px;
  right: 0;
  bottom: 72px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  width: min(380px, 90vw);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  background: #0f0f0f;
  color: #fff;
  font: 14px/1.5 Roboto, Arial, sans-serif;
}
.${PANEL_CLASS}[hidden] { display: none; }
.${PANEL_CLASS} > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-weight: 500;
}
.${PANEL_CLASS} > header small {
  margin-left: 8px;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 400;
}
.${PANEL_CLASS} > header button {
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 18px;
  cursor: pointer;
}
.${PANEL_CLASS}-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.${PANEL_CLASS}-body > iframe {
  flex: 1;
  width: 100%;
  border: 0;
}
`;

const styled = new WeakSet<Document>();
/** The panel currently shown in each document. All panels share one place, so there is at most one. */
const shown = new WeakMap<Document, { close: () => void }>();

/**
 * Creates a hidden side panel with a title bar and a close button.
 *
 * Showing a panel closes the one that is open, since they occupy the same
 * place. The panel's element is added to the page once and never moved, so an
 * iframe inside it keeps running.
 */
export function createPanel(
  title: string,
  doc: Document = document,
  addCss: (css: string, doc: Document) => unknown = injectCss,
): Panel {
  if (!styled.has(doc)) {
    styled.add(doc);
    addCss(CSS, doc);
  }

  // Trusted Types forbid innerHTML here: build elements by hand.
  const element = doc.createElement("aside");
  element.className = PANEL_CLASS;
  element.hidden = true;
  const header = element.appendChild(doc.createElement("header"));
  const heading = header.appendChild(doc.createElement("span"));
  const titleText = heading.appendChild(doc.createTextNode(title));
  const subtitle = heading.appendChild(doc.createElement("small"));
  const closeButton = header.appendChild(doc.createElement("button"));
  closeButton.textContent = "✕";
  closeButton.title = t("Close");
  closeButton.setAttribute("aria-label", t("Close panel"));
  const body = element.appendChild(doc.createElement("div"));
  body.className = `${PANEL_CLASS}-body`;

  const closeHandlers: (() => void)[] = [];
  const setTitle = (text: string): void => {
    titleText.data = text;
    element.setAttribute("aria-label", text);
  };
  const hide = (): void => {
    element.hidden = true;
    if (shown.get(doc) === self) shown.delete(doc);
  };
  /** Hides the panel and tells its owner, who did not ask for it. */
  const close = (): void => {
    if (element.hidden) return;
    hide();
    for (const handler of [...closeHandlers]) handler();
  };
  const self = { close };

  setTitle(title);
  closeButton.addEventListener("click", close);
  (doc.body ?? doc.documentElement).appendChild(element);

  return {
    body,
    get open() {
      return !element.hidden;
    },
    show() {
      const current = shown.get(doc);
      if (current !== self) current?.close();
      shown.set(doc, self);
      element.hidden = false;
    },
    hide,
    setTitle(text, subtitleText = "") {
      setTitle(text);
      subtitle.textContent = subtitleText;
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
    remove() {
      hide();
      element.remove();
    },
  };
}

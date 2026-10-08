import { injectCss } from "./css";
import { t } from "../i18n";

const BUTTON_ID = "ytmd-settings-button";

const CSS = `
#${BUTTON_ID} {
  width: 40px;
  height: 40px;
  margin: 0 4px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
#${BUTTON_ID}:hover { background: rgba(255, 255, 255, 0.1); }
`;

/** Adds the button that opens the app's settings window to the navigation bar. */
export function addSettingsButton(navBar: Element, onClick: () => void): void {
  if (navBar.ownerDocument.getElementById(BUTTON_ID)) return;
  injectCss(CSS, navBar.ownerDocument);
  // Trusted Types forbid innerHTML here: build the element by hand.
  const button = navBar.ownerDocument.createElement("button");
  button.id = BUTTON_ID;
  button.textContent = "⚙";
  button.title = t("Desktop settings");
  button.setAttribute("aria-label", t("Desktop settings"));
  button.addEventListener("click", onClick);
  (navBar.querySelector(".right-content") ?? navBar).prepend(button);
}

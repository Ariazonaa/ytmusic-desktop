import { injectCss } from "./css";
import { SELECTORS, waitForElement } from "./dom";

const BUTTON_CLASS = "ytmd-nav-button";

const CSS = `
.${BUTTON_CLASS} {
  margin: 0 4px;
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 16px;
  background: transparent;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
.${BUTTON_CLASS}:hover { background: rgba(255, 255, 255, 0.1); }
`;

const styled = new WeakSet<Document>();

/**
 * Adds a text button to the navigation bar, waiting for the bar if needed.
 * Returns a function that removes the button.
 */
export function addNavButton(label: string, onClick: () => void, doc: Document = document): () => void {
  if (!styled.has(doc)) {
    styled.add(doc);
    injectCss(CSS, doc);
  }
  // Trusted Types forbid innerHTML here: build the element by hand.
  const button = doc.createElement("button");
  button.className = BUTTON_CLASS;
  button.textContent = label;
  button.addEventListener("click", onClick);

  let removed = false;
  void waitForElement(SELECTORS.navBar, doc).then((navBar) => {
    if (!removed) (navBar.querySelector(".right-content") ?? navBar).prepend(button);
  });
  return () => {
    removed = true;
    button.remove();
  };
}

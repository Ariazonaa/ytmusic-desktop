import type { NoticeAction } from "../../shared/types";
import { injectCss } from "./css";

const NOTICE_ID = "ytmd-notice";
const VISIBLE_MS = 4000;
/** A notice with a button stays longer, so that there is time to press it. */
const VISIBLE_WITH_ACTION_MS = 8000;

const CSS = `
#${NOTICE_ID} {
  position: fixed;
  left: 50%;
  bottom: 88px;
  transform: translateX(-50%);
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 80vw;
  padding: 8px 16px;
  border-radius: 18px;
  background: rgba(28, 28, 28, 0.95);
  color: #fff;
  font: 14px Roboto, Arial, sans-serif;
  pointer-events: none;
}
#${NOTICE_ID} button {
  padding: 2px 10px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  pointer-events: auto;
}
#${NOTICE_ID} button:hover { background: rgba(255, 255, 255, 0.12); }
`;

const styled = new WeakSet<Document>();
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Shows a short message above the player bar. A new message replaces the
 * current one. With an `action`, the message carries a button; pressing it
 * runs the action and closes the message.
 */
export function showNotice(text: string, action?: NoticeAction, doc: Document = document): void {
  if (!styled.has(doc)) {
    styled.add(doc);
    injectCss(CSS, doc);
  }
  let notice = doc.getElementById(NOTICE_ID);
  if (!notice) {
    notice = doc.createElement("div");
    notice.id = NOTICE_ID;
    notice.setAttribute("role", "status");
    doc.body.appendChild(notice);
  }
  const close = (): void => {
    clearTimeout(timer);
    doc.getElementById(NOTICE_ID)?.remove();
  };
  notice.replaceChildren(doc.createTextNode(text));
  if (action) {
    const button = notice.appendChild(doc.createElement("button"));
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      close();
      action.onClick();
    });
  }
  clearTimeout(timer);
  timer = setTimeout(close, action ? VISIBLE_WITH_ACTION_MS : VISIBLE_MS);
}

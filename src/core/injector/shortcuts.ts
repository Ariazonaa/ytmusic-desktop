// Keyboard shortcuts that work while the app's window has the focus. Global
// shortcuts, which work everywhere, are the backend's business.
import { isShortcut, shortcutFrom } from "../../shared/shortcut";

const handlers = new WeakMap<Document, Map<string, Set<() => void>>>();

/** Whether a key press lands in a field the user is typing in. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") !== null;
}

function listen(doc: Document): Map<string, Set<() => void>> {
  const registered = new Map<string, Set<() => void>>();
  // Capture phase: before YouTube Music's own shortcuts see the key.
  doc.addEventListener(
    "keydown",
    (event) => {
      if (event.repeat || isTyping(event.target)) return;
      const shortcut = shortcutFrom(event);
      const run = shortcut ? registered.get(shortcut) : undefined;
      if (!run || run.size === 0) return;
      event.preventDefault();
      event.stopPropagation();
      for (const handler of [...run]) handler();
    },
    true,
  );
  return registered;
}

/**
 * Calls `onPress` when `shortcut` is pressed in the app's window, except
 * while the user types in a field. `shortcut` is written like
 * `Ctrl+Shift+KeyL`, see `shortcutFrom`. Returns a function that removes it.
 * Throws if `shortcut` is not a valid one.
 */
export function addShortcut(shortcut: string, onPress: () => void, doc: Document = document): () => void {
  if (!isShortcut(shortcut)) throw new Error(`not a shortcut: ${JSON.stringify(shortcut)}`);
  let registered = handlers.get(doc);
  if (!registered) {
    registered = listen(doc);
    handlers.set(doc, registered);
  }
  const run = registered.get(shortcut) ?? new Set<() => void>();
  registered.set(shortcut, run);
  // A wrapper, so that the same function can be registered twice and removed separately.
  const handler = (): void => onPress();
  run.add(handler);
  return () => run.delete(handler);
}

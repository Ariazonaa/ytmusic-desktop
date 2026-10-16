// Turning key presses into the shortcut texts the backend stores, and back
// into something readable.

/** The part of a keyboard event that matters for a shortcut. */
export interface KeyPress {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

// Kept in step with the backend by a test in `src-tauri/src/shortcuts.rs`.
const KEYS =
  /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-9]|2[0-4])|Arrow(Up|Down|Left|Right)|PageUp|PageDown|Home|End|Insert|Space|Minus|Equal|Comma|Period|Slash|Backslash|Semicolon|Quote|BracketLeft|BracketRight|Backquote|Numpad(Add|Subtract|Multiply|Divide))$/;

/**
 * The shortcut for a key press, e.g. `Ctrl+Alt+ArrowUp`, or `null` if the
 * press is not a usable one: a modifier on its own, an unsupported key, or a
 * key without Ctrl, Alt or the Windows key. A global shortcut takes its keys
 * away from every other program, so plain letters are not accepted. Function
 * keys may stand alone.
 */
export function shortcutFrom(press: KeyPress): string | null {
  if (!KEYS.test(press.code)) return null;
  const isFunctionKey = /^F\d+$/.test(press.code);
  if (!press.ctrlKey && !press.altKey && !press.metaKey && !isFunctionKey) return null;
  const parts: string[] = [];
  if (press.ctrlKey) parts.push("Ctrl");
  if (press.altKey) parts.push("Alt");
  if (press.shiftKey) parts.push("Shift");
  if (press.metaKey) parts.push("Super");
  return [...parts, press.code].join("+");
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "Page Up",
  PageDown: "Page Down",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  Super: "Win",
};

/** A stored shortcut as shown to the user, e.g. `Ctrl + Alt + ↑`. */
export function describeShortcut(shortcut: string): string {
  if (shortcut === "") return "Not set";
  return shortcut
    .split("+")
    .map((part) => KEY_NAMES[part] ?? part.replace(/^(Key|Digit)/, "").replace(/^Numpad(\d)$/, "Num $1"))
    .join(" + ");
}

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Super"];

/**
 * Combinations the app's window keeps for itself: copying and pasting,
 * selecting, undoing, searching the page, reloading, zooming, going back and
 * the developer tools. A plugin cannot take them.
 */
const RESERVED_IN_WINDOW = new Set([
  "Ctrl+KeyA",
  "Ctrl+KeyC",
  "Ctrl+KeyV",
  "Ctrl+KeyX",
  "Ctrl+KeyZ",
  "Ctrl+KeyY",
  "Ctrl+Shift+KeyZ",
  "Ctrl+KeyF",
  "Ctrl+KeyR",
  "Ctrl+Shift+KeyR",
  "Ctrl+KeyP",
  "Ctrl+Equal",
  "Ctrl+Shift+Equal",
  "Ctrl+Minus",
  "Ctrl+Digit0",
  "Ctrl+NumpadAdd",
  "Ctrl+NumpadSubtract",
  "Ctrl+Numpad0",
  "Alt+ArrowLeft",
  "Alt+ArrowRight",
  "Ctrl+Shift+KeyI",
  "Ctrl+Shift+KeyJ",
  "Ctrl+Shift+KeyC",
  "F3",
  "F5",
  "Ctrl+F5",
  "F7",
  "F11",
  "F12",
]);

/** Whether the app's window keeps `shortcut` for itself, so that a plugin cannot use it. */
export function isReservedInWindow(shortcut: string): boolean {
  return RESERVED_IN_WINDOW.has(shortcut);
}

/**
 * Whether `text` is a shortcut as `shortcutFrom` writes them: modifiers in
 * the order Ctrl, Alt, Shift, Super, then one key, with the same rule about
 * which keys may stand without a modifier.
 */
export function isShortcut(text: string): boolean {
  const parts = text.split("+");
  const code = parts.pop() ?? "";
  if (!KEYS.test(code)) return false;
  const order = parts.map((part) => MODIFIERS.indexOf(part));
  if (order.some((index, position) => index < 0 || (position > 0 && index <= (order[position - 1] ?? -1)))) return false;
  const hasModifier = parts.some((part) => part !== "Shift");
  return hasModifier || /^F\d+$/.test(code);
}

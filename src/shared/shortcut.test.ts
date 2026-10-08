import { describe, expect, it } from "vitest";
import { describeShortcut, isShortcut, shortcutFrom, type KeyPress } from "./shortcut";

const press = (code: string, modifiers: Partial<KeyPress> = {}): KeyPress => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
});

describe("shortcutFrom", () => {
  it("writes modifiers in a fixed order, then the key", () => {
    expect(shortcutFrom(press("ArrowUp", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+ArrowUp");
    expect(shortcutFrom(press("KeyM", { metaKey: true, shiftKey: true, altKey: true, ctrlKey: true }))).toBe(
      "Ctrl+Alt+Shift+Super+KeyM",
    );
  });

  it("waits while only modifiers are held", () => {
    expect(shortcutFrom(press("ControlLeft", { ctrlKey: true }))).toBeNull();
    expect(shortcutFrom(press("AltRight", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutFrom(press("MetaLeft", { metaKey: true }))).toBeNull();
  });

  it("refuses keys that would be taken from every program", () => {
    expect(shortcutFrom(press("KeyM"))).toBeNull();
    expect(shortcutFrom(press("KeyM", { shiftKey: true }))).toBeNull();
    expect(shortcutFrom(press("Space"))).toBeNull();
  });

  it("lets function keys stand alone", () => {
    expect(shortcutFrom(press("F9"))).toBe("F9");
    expect(shortcutFrom(press("F9", { shiftKey: true }))).toBe("Shift+F9");
  });

  it("refuses keys the backend does not know", () => {
    expect(shortcutFrom(press("Escape", { ctrlKey: true }))).toBeNull();
    expect(shortcutFrom(press("Tab", { altKey: true }))).toBeNull();
    expect(shortcutFrom(press("F25", { ctrlKey: true }))).toBeNull();
    expect(shortcutFrom(press("AudioVolumeUp", { ctrlKey: true }))).toBeNull();
  });
});

describe("describeShortcut", () => {
  it("makes stored shortcuts readable", () => {
    expect(describeShortcut("Ctrl+Alt+ArrowUp")).toBe("Ctrl + Alt + ↑");
    expect(describeShortcut("Ctrl+Shift+KeyM")).toBe("Ctrl + Shift + M");
    expect(describeShortcut("Super+Digit5")).toBe("Win + 5");
    expect(describeShortcut("Alt+Numpad3")).toBe("Alt + Num 3");
    expect(describeShortcut("Ctrl+NumpadAdd")).toBe("Ctrl + Num +");
    expect(describeShortcut("F9")).toBe("F9");
  });

  it("says when none is set", () => {
    expect(describeShortcut("")).toBe("Not set");
  });
});

describe("isShortcut", () => {
  it("accepts what shortcutFrom writes", () => {
    for (const shortcut of ["Ctrl+KeyL", "Ctrl+Alt+Shift+Super+ArrowUp", "Alt+Digit1", "F9", "Shift+F9", "Super+Space"]) {
      expect(isShortcut(shortcut), shortcut).toBe(true);
    }
  });

  it("refuses everything else", () => {
    for (const shortcut of ["", "KeyL", "Shift+KeyL", "Ctrl+L", "Alt+Ctrl+KeyL", "Ctrl+Ctrl+KeyL", "Ctrl+", "Ctrl+KeyL+KeyM", "ctrl+KeyL", "Ctrl + KeyL"]) {
      expect(isShortcut(shortcut), shortcut).toBe(false);
    }
  });
});

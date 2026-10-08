import { afterEach, describe, expect, it, vi } from "vitest";
import { addShortcut } from "./shortcuts";

const press = (init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("addShortcut", () => {
  it("runs the handler for its combination only, and keeps the key from the page", () => {
    const onPress = vi.fn();
    const pageHandler = vi.fn();
    document.body.addEventListener("keydown", pageHandler);
    const remove = addShortcut("Ctrl+Shift+KeyL", onPress);

    press({ code: "KeyL", ctrlKey: true });
    press({ code: "KeyK", ctrlKey: true, shiftKey: true });
    expect(onPress).not.toHaveBeenCalled();
    expect(pageHandler).toHaveBeenCalledTimes(2);

    const event = press({ code: "KeyL", ctrlKey: true, shiftKey: true });
    expect(onPress).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(pageHandler).toHaveBeenCalledTimes(2);

    remove();
    document.body.removeEventListener("keydown", pageHandler);
  });

  it("stops after removal", () => {
    const onPress = vi.fn();
    const remove = addShortcut("F9", onPress);
    press({ code: "F9" });
    remove();
    const event = press({ code: "F9" });
    expect(onPress).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves typing alone and ignores a key held down", () => {
    const onPress = vi.fn();
    const remove = addShortcut("Alt+KeyE", onPress);
    const input = document.body.appendChild(document.createElement("input"));
    press({ code: "KeyE", altKey: true }, input);
    press({ code: "KeyE", altKey: true, repeat: true });
    expect(onPress).not.toHaveBeenCalled();
    remove();
  });

  it("serves several handlers of one combination", () => {
    const first = vi.fn();
    const second = vi.fn();
    const removeFirst = addShortcut("Ctrl+KeyM", first);
    const removeSecond = addShortcut("Ctrl+KeyM", second);
    press({ code: "KeyM", ctrlKey: true });
    removeFirst();
    press({ code: "KeyM", ctrlKey: true });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    removeSecond();
  });

  it("refuses what is not a shortcut", () => {
    expect(() => addShortcut("KeyL", () => {})).toThrow("not a shortcut");
    expect(() => addShortcut("", () => {})).toThrow("not a shortcut");
  });
});

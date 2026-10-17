// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { Dropdown } from "./dropdown";

function make() {
  const onChange = vi.fn();
  const dropdown = new Dropdown(document, { label: "Preset", onChange });
  dropdown.setOptions([
    { value: "flat", label: "Flat" },
    { value: "rock", label: "Rock" },
    { value: "user:Mine", label: "Mine", group: "Saved" },
    { value: "user:Other", label: "Other", group: "Saved" },
    { value: "custom", label: "Custom" },
  ]);
  dropdown.value = "flat";
  document.body.replaceChildren(dropdown.element);
  const button = dropdown.element.querySelector("button")!;
  const list = dropdown.element.querySelector<HTMLElement>("[role=listbox]")!;
  const key = (key: string): void => {
    button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  };
  return { dropdown, onChange, button, list, key };
}

describe("Dropdown", () => {
  it("shows the chosen option and lists the others, grouped", () => {
    const { button, list } = make();
    expect(button.getAttribute("role")).toBe("combobox");
    expect(button.textContent).toBe("Flat");
    expect(list.hidden).toBe(true);
    button.click();
    expect(list.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect([...list.children].map((child) => child.textContent)).toEqual(["Flat", "Rock", "Saved", "Mine", "Other", "Custom"]);
    expect(list.querySelector("[aria-selected=true]")?.textContent).toBe("Flat");
  });

  it("indents grouped options, and only those", () => {
    const { list } = make();
    const grouped = [...list.querySelectorAll(".is-grouped")].map((option) => option.textContent);
    expect(grouped).toEqual(["Mine", "Other"]);
  });

  it("does not hand the keys it uses to the page", () => {
    const { button } = make();
    const page = vi.fn();
    document.body.addEventListener("keydown", page);
    for (const key of [" ", "ArrowDown", "Escape"]) {
      button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    expect(page).not.toHaveBeenCalled();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("chooses with the mouse", () => {
    const { button, list, onChange } = make();
    button.click();
    const rock = [...list.querySelectorAll("[role=option]")].find((option) => option.textContent === "Rock")!;
    rock.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(onChange).toHaveBeenCalledWith("rock");
    expect(button.textContent).toBe("Rock");
    expect(list.hidden).toBe(true);
  });

  it("works with the keyboard alone", () => {
    const { button, list, onChange, key, dropdown } = make();
    key("ArrowDown");
    expect(list.hidden).toBe(false);
    key("ArrowDown");
    key("ArrowDown");
    expect(button.getAttribute("aria-activedescendant")).toBe(list.querySelector(".is-active")?.id);
    expect(list.querySelector(".is-active")?.textContent).toBe("Mine");
    key("Enter");
    expect(onChange).toHaveBeenCalledWith("user:Mine");
    expect(dropdown.value).toBe("user:Mine");

    key(" ");
    key("End");
    key("Escape");
    expect(list.hidden).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the same option is chosen, and does nothing while disabled", () => {
    const { button, list, onChange, key, dropdown } = make();
    key("Enter");
    key("Enter");
    expect(onChange).not.toHaveBeenCalled();
    dropdown.disabled = true;
    button.click();
    expect(list.hidden).toBe(true);
  });
});

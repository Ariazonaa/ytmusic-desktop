// A select drawn by the page. A native <select> opens its list as a menu of
// the system; WebKitGTK on Linux draws that in GTK's theme, light in a dark
// window, whatever the page's styles say. This one looks the same everywhere.
// It builds its elements with createElement only, so that it also works in
// YouTube Music's page, which enforces Trusted Types.

export interface DropdownOption {
  value: string;
  label: string;
  /**
   * Options next to each other with the same group are listed under its name,
   * indented, as in an <optgroup>. Without one, an option stands on its own.
   */
  group?: string;
}

interface DropdownSettings {
  /** What the control is for, for screen readers. */
  label: string;
  onChange: (value: string) => void;
}

let nextId = 1;

export class Dropdown {
  /** Put this into the page. */
  readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly text: HTMLElement;
  private readonly list: HTMLElement;
  private options: DropdownOption[] = [];
  private items: HTMLElement[] = [];
  private current = "";
  /** The option the keyboard is on while the list is open. */
  private active = -1;
  private readonly id = `ytmd-dropdown-${nextId++}`;

  constructor(
    private readonly doc: Document,
    private readonly settings: DropdownSettings,
  ) {
    this.element = doc.createElement("div");
    this.element.className = "ytmd-dropdown";
    this.button = this.element.appendChild(doc.createElement("button"));
    this.button.type = "button";
    this.button.className = "ytmd-dropdown-button";
    this.button.setAttribute("role", "combobox");
    this.button.setAttribute("aria-haspopup", "listbox");
    this.button.setAttribute("aria-expanded", "false");
    this.button.setAttribute("aria-controls", this.id);
    this.button.setAttribute("aria-label", settings.label);
    this.text = this.button.appendChild(doc.createElement("span"));
    this.text.className = "ytmd-dropdown-text";
    this.list = this.element.appendChild(doc.createElement("div"));
    this.list.id = this.id;
    this.list.className = "ytmd-dropdown-list";
    this.list.setAttribute("role", "listbox");
    this.list.setAttribute("aria-label", settings.label);
    this.list.hidden = true;

    this.button.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));
    this.button.addEventListener("keydown", (event) => this.onKey(event));
    this.button.addEventListener("blur", () => {
      // A click on an option moves the focus away first; let it land.
      setTimeout(() => {
        if (!this.element.contains(this.doc.activeElement)) this.close();
      }, 150);
    });
  }

  get value(): string {
    return this.current;
  }

  set value(value: string) {
    this.current = value;
    this.render();
  }

  set disabled(disabled: boolean) {
    this.button.disabled = disabled;
    if (disabled) this.close();
  }

  get isOpen(): boolean {
    return !this.list.hidden;
  }

  setOptions(options: readonly DropdownOption[]): void {
    this.options = [...options];
    this.list.replaceChildren();
    this.items = [];
    let group: string | undefined;
    this.options.forEach((option, index) => {
      if (option.group && option.group !== group) {
        const heading = this.list.appendChild(this.doc.createElement("div"));
        heading.className = "ytmd-dropdown-group";
        heading.setAttribute("role", "presentation");
        heading.textContent = option.group;
      }
      group = option.group;
      const item = this.list.appendChild(this.doc.createElement("div"));
      item.className = option.group ? "ytmd-dropdown-option is-grouped" : "ytmd-dropdown-option";
      item.setAttribute("role", "option");
      item.id = `${this.id}-${index}`;
      item.textContent = option.label;
      // Not a click: the button would lose the focus first and close the list.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.choose(index);
      });
      item.addEventListener("mousemove", () => this.highlight(index));
      this.items.push(item);
    });
    this.render();
  }

  private render(): void {
    const selected = this.options.findIndex((option) => option.value === this.current);
    this.text.textContent = selected >= 0 ? (this.options[selected]?.label ?? "") : "";
    this.items.forEach((item, index) => item.setAttribute("aria-selected", String(index === selected)));
  }

  open(): void {
    if (this.button.disabled || this.options.length === 0) return;
    this.list.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.highlight(Math.max(0, this.options.findIndex((option) => option.value === this.current)));
  }

  close(): void {
    this.list.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    this.button.removeAttribute("aria-activedescendant");
    this.active = -1;
  }

  private highlight(index: number): void {
    this.active = index;
    this.items.forEach((item, i) => item.classList.toggle("is-active", i === index));
    const item = this.items[index];
    if (item) {
      this.button.setAttribute("aria-activedescendant", item.id);
      item.scrollIntoView?.({ block: "nearest" });
    }
  }

  private choose(index: number): void {
    const option = this.options[index];
    this.close();
    this.button.focus();
    if (!option || option.value === this.current) return;
    this.current = option.value;
    this.render();
    this.settings.onChange(option.value);
  }

  private onKey(event: KeyboardEvent): void {
    const last = this.options.length - 1;
    // A key the list uses is not also the page's: in YouTube Music, Space
    // would pause and the arrows would seek.
    const handled = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (index: number): void => {
      handled();
      if (!this.isOpen) this.open();
      else this.highlight(Math.min(last, Math.max(0, index)));
    };
    switch (event.key) {
      case "ArrowDown":
        move(this.active + 1);
        break;
      case "ArrowUp":
        move(this.active - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(last);
        break;
      case "Enter":
      case " ":
        handled();
        if (this.isOpen && this.active >= 0) this.choose(this.active);
        else this.open();
        break;
      case "Escape":
        if (this.isOpen) {
          handled();
          this.close();
        }
        break;
      case "Tab":
        this.close();
        break;
    }
  }
}

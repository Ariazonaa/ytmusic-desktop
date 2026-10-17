// A window shortcut that follows a plugin's `shortcut` setting.
import type { PluginApi } from "../shared/types";

export class SettingShortcut {
  private remove: (() => void) | undefined;
  private registered = "";

  constructor(private readonly run: () => void) {}

  /** Registers what the setting says now, in place of what was registered before. */
  apply(api: PluginApi | undefined): void {
    const setting = api?.settings.get("shortcut");
    const wanted = typeof setting === "string" ? setting : "";
    if (wanted === this.registered) return;
    this.clear();
    if (!api || wanted === "") return;
    try {
      this.remove = api.ui.addShortcut(wanted, this.run);
      this.registered = wanted;
    } catch (error) {
      console.warn(`[ytm-desktop] cannot use the shortcut ${wanted}:`, error);
    }
  }

  /** Forgets the shortcut. Unloading the plugin removes it anyway. */
  clear(): void {
    this.remove?.();
    this.remove = undefined;
    this.registered = "";
  }
}

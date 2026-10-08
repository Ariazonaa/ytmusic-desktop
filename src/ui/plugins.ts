import { parseManifest } from "../core/plugin-manager/api";
import { listExternalPlugins } from "../core/settings/client";
import { validateExternalPlugins } from "../plugins/external";
import type { PluginManifest } from "../shared/types";

export interface ListedPlugin {
  manifest: PluginManifest;
  /** Loaded from the user's plugins folder instead of shipped with the app. */
  external: boolean;
}

// Only the manifests are imported: plugin code belongs in the YouTube Music page.
const modules = import.meta.glob<unknown>("../plugins/*/plugin.json", {
  eager: true,
  import: "default",
});

const builtin: ListedPlugin[] = Object.values(modules)
  .map(parseManifest)
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((manifest) => ({ manifest, external: false }));

/**
 * All plugins the user can switch on: the built-in ones, then those from the
 * plugins folder. `rejected` names folders that are not valid plugins and why.
 */
export async function listPlugins(): Promise<{ plugins: ListedPlugin[]; rejected: string[] }> {
  const rejected: string[] = [];
  const external = validateExternalPlugins(
    await listExternalPlugins(),
    builtin.map((plugin) => plugin.manifest.name),
    (folder, reason) => rejected.push(`${folder}: ${reason}`),
  ).map(({ manifest }) => ({ manifest, external: true }));
  return { plugins: [...builtin, ...external], rejected };
}

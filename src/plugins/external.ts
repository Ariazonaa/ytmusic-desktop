import { parseManifest } from "../core/plugin-manager/api";
import type { ExternalPluginInfo, PluginManifest } from "../shared/types";

export interface ExternalManifest {
  manifest: PluginManifest;
  frameUrl: string;
}

/**
 * Validates the plugins found in the user's plugins folder. A plugin is
 * rejected if its manifest is invalid, if its name differs from its folder or
 * if it would shadow another plugin. `onReject` is told why.
 */
export function validateExternalPlugins(
  found: readonly ExternalPluginInfo[],
  takenNames: readonly string[],
  onReject: (folder: string, reason: string) => void = () => {},
): ExternalManifest[] {
  const taken = new Set(takenNames);
  const valid: ExternalManifest[] = [];
  for (const { name: folder, manifest: json, frameUrl } of found) {
    try {
      const manifest = parseManifest(json);
      if (manifest.name !== folder) {
        throw new Error(`manifest name "${manifest.name}" does not match the folder`);
      }
      if (taken.has(folder)) throw new Error("a plugin with this name already exists");
      taken.add(folder);
      valid.push({ manifest, frameUrl });
    } catch (error) {
      onReject(folder, error instanceof Error ? error.message : String(error));
    }
  }
  return valid;
}

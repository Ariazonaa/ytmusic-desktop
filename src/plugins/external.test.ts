import { describe, expect, it, vi } from "vitest";
import { validateExternalPlugins } from "./external";

const info = (name: string, manifest: unknown) => ({
  name,
  manifest,
  frameUrl: `http://ytmd-plugin.localhost/${name}/`,
});
const manifest = (name: string) => ({ name, version: "1.0.0", permissions: [] });

describe("validateExternalPlugins", () => {
  it("accepts valid plugins", () => {
    const valid = validateExternalPlugins([info("hello", manifest("hello"))], ["demo"]);
    expect(valid).toEqual([
      { manifest: manifest("hello"), frameUrl: "http://ytmd-plugin.localhost/hello/" },
    ]);
  });

  it("rejects invalid manifests, mismatched names and name clashes", () => {
    const onReject = vi.fn();
    const valid = validateExternalPlugins(
      [
        info("broken", { name: "broken" }),
        info("folder", manifest("other")),
        info("demo", manifest("demo")),
        info("twice", manifest("twice")),
        info("twice", manifest("twice")),
      ],
      ["demo"],
      onReject,
    );
    expect(valid.map((plugin) => plugin.manifest.name)).toEqual(["twice"]);
    expect(onReject.mock.calls.map(([folder]) => folder as string)).toEqual([
      "broken",
      "folder",
      "demo",
      "twice",
    ]);
  });
});

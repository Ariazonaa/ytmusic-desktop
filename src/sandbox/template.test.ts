import { describe, expect, it } from "vitest";
import manifest from "../../examples/plugins/template/plugin.json";

// The template carries its own copy of the type files, so that a copied
// folder is complete. `ytmd-types.check.ts` checks the copy in `hello`
// against the sandbox; this keeps the template's copy the same.
const typeFiles = import.meta.glob<string>("../../examples/plugins/{hello,template}/*.d.ts", {
  eager: true,
  query: "?raw",
  import: "default",
});

describe("examples/plugins/template", () => {
  for (const file of ["ytmd.d.ts", "ytmd-api.d.ts"]) {
    it(`has the same ${file} as the hello example`, () => {
      const read = (plugin: string): string | undefined =>
        typeFiles[`../../examples/plugins/${plugin}/${file}`]?.replace(/\r\n/g, "\n");
      expect(read("template")).toBeDefined();
      expect(read("template")).toBe(read("hello"));
    });
  }

  it("has a manifest the app accepts as a start", () => {
    expect(manifest.name).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(manifest.description.length).toBeLessThanOrEqual(300);
  });
});

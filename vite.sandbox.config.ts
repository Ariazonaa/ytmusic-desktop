import { defineConfig } from "vite";

// Builds the script that runs inside a sandboxed plugin iframe. Rust serves it
// as `/_bootstrap.js` on the plugin scheme.
export default defineConfig({
  build: {
    outDir: "dist-inject",
    // The inject build writes to the same folder and runs first.
    emptyOutDir: false,
    target: "es2022",
    lib: {
      entry: "src/sandbox/bootstrap.ts",
      formats: ["iife"],
      name: "YtmDesktopSandbox",
      fileName: () => "sandbox.js",
    },
  },
});

import { defineConfig } from "vite";

// Builds the script that Rust injects into the YouTube Music page.
// It must be a single self-contained IIFE: the page cannot load modules from us.
export default defineConfig({
  build: {
    outDir: "dist-inject",
    // The sandbox build writes to the same folder, and a watch build must not delete its output.
    emptyOutDir: false,
    target: "es2022",
    lib: {
      entry: "src/inject/main.ts",
      formats: ["iife"],
      name: "YtmDesktop",
      fileName: () => "inject.js",
    },
  },
});

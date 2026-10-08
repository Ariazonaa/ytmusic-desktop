import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Builds the settings window, the only UI the app serves itself.
export default defineConfig({
  root: "src/ui",
  plugins: [
    // The config sits next to this file. The path is relative to `root`.
    svelte({ configFile: "../../svelte.config.js" }),
    tailwindcss(),
  ],
  // Development only: `tauri dev` loads the settings window from this server (`devUrl`).
  server: {
    port: 1420,
    strictPort: true,
    // Change notifications do not work on network drives, where the repo may
    // live. Polling does, and the settings window has few files to check.
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    outDir: "../../dist-ui",
    emptyOutDir: true,
    target: "es2022",
  },
});

import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Builds the settings window and the lyrics window, the UI the app serves itself.
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
    rollupOptions: {
      input: {
        // Relative to the folder the build runs in, the repository's.
        main: "src/ui/index.html",
        overlay: "src/ui/overlay.html",
      },
    },
  },
});

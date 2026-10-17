import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Only the tests of the settings window need Svelte: they mount its components.
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    // The settings window's tests click through several steps each, which
    // takes longer than the default 5 seconds on a busy CI runner.
    testTimeout: 20000,
  },
});

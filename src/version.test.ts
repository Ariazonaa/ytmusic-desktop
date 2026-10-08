import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import cargoLock from "../src-tauri/Cargo.lock?raw";
import cargoToml from "../src-tauri/Cargo.toml?raw";
import tauriConfig from "../src-tauri/tauri.conf.json";

// The version is maintained in package.json. `npm version` copies it to the
// Rust side (scripts/sync-version.mjs); this fails if someone edited one by hand.
describe("version", () => {
  it("is the same in package.json and on the Rust side", () => {
    const inToml = /\[package\]\r?\nname = "ytmusic-desktop"\r?\nversion = "([^"]+)"/.exec(cargoToml)?.[1];
    const inLock = /name = "ytmusic-desktop"\r?\nversion = "([^"]+)"/.exec(cargoLock)?.[1];
    expect(inToml).toBe(packageJson.version);
    expect(inLock).toBe(packageJson.version);
  });

  it("is read from package.json by the app's configuration", () => {
    expect(tauriConfig.version).toBe("../package.json");
  });

  it("has an entry in the changelog", async () => {
    const changelog = (await import("../CHANGELOG.md?raw")).default;
    expect(changelog).toContain(`## ${packageJson.version}`);
  });
});

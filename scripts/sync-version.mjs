// Copies the version from package.json, where it is maintained, into the two
// Rust files that cannot read it from there. Runs as part of `npm version`.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`unexpected version: ${version}`);

/** Replaces the version of the package `ytmusic-desktop` in a TOML file. */
function setVersion(file, pattern) {
  const text = readFileSync(file, "utf8");
  if (!pattern.test(text)) throw new Error(`${file}: no version of ytmusic-desktop found`);
  writeFileSync(file, text.replace(pattern, `$1${version}$2`));
}

setVersion("src-tauri/Cargo.toml", /(\[package\]\r?\nname = "ytmusic-desktop"\r?\nversion = ")[^"]+(")/);
setVersion("src-tauri/Cargo.lock", /(name = "ytmusic-desktop"\r?\nversion = ")[^"]+(")/);
console.log(`version ${version} written to src-tauri/Cargo.toml and Cargo.lock`);

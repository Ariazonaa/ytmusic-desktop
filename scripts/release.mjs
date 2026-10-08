// Puts together what a release consists of, from a build made with
// `npm run tauri build -- --config src-tauri/tauri.release.conf.json`:
//
//   release/ytmusic-desktop_<version>_x64-setup.exe   the installer
//   release/latest.json                               what running apps ask for to learn of the update
//   release/notes.md                                  this version's part of CHANGELOG.md
//
// Usage: node scripts/release.mjs [tag]
// With a tag, it has to be `v<version>`. CARGO_TARGET_DIR is honored.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPOSITORY = "https://github.com/Ariazonaa/ytmusic-desktop";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tag = process.argv[2] ?? `v${version}`;
if (tag !== `v${version}`) throw new Error(`the tag ${tag} does not fit version ${version} in package.json`);

// This version's part of the changelog: from its heading to the next one.
const changelog = readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
const start = changelog.indexOf(`\n## ${version}\n`);
if (start < 0) throw new Error(`CHANGELOG.md has no entry for ${version}`);
const rest = changelog.slice(start + `\n## ${version}\n`.length);
const end = rest.indexOf("\n## ");
// The changelog wraps its lines; the app shows the notes as they are, so each point becomes one line.
const notes = (end < 0 ? rest : rest.slice(0, end)).trim().replace(/\n {2,}(?=\S)/g, " ");
if (!notes) throw new Error(`the entry for ${version} in CHANGELOG.md is empty`);

const bundle = join(process.env.CARGO_TARGET_DIR ?? "src-tauri/target", "release", "bundle", "nsis");
const built = readdirSync(bundle).find((file) => file.endsWith(`_${version}_x64-setup.exe`));
if (!built) throw new Error(`no installer for ${version} in ${bundle}`);
// Written by the build when it knows the signing key. Running apps refuse an update without it.
const signature = readFileSync(join(bundle, `${built}.sig`), "utf8").trim();
if (!signature) throw new Error("the installer's signature is empty");

const installer = `ytmusic-desktop_${version}_x64-setup.exe`;
rmSync("release", { recursive: true, force: true });
mkdirSync("release");
copyFileSync(join(bundle, built), join("release", installer));
writeFileSync(join("release", "notes.md"), notes + "\n");
writeFileSync(
  join("release", "latest.json"),
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: { "windows-x86_64": { signature, url: `${REPOSITORY}/releases/download/${tag}/${installer}` } },
    },
    null,
    2,
  ) + "\n",
);
console.log(`release/ holds ${installer}, latest.json and notes.md for ${tag}`);

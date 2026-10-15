// Puts together what a release consists of, from a build made with
// `npm run tauri build -- --config src-tauri/tauri.release.conf.json`:
//
//   release/ytmusic-desktop_<version>_x64-setup.exe     the installer
//   release/ytmusic-desktop_<version>_x64-portable.zip  the program without installer
//   release/SHA256SUMS.txt                              checksums of the two
//   release/latest.json                                 what running apps ask for to learn of the update
//   release/notes.md                                    this version's part of CHANGELOG.md
//
// Usage: node scripts/release.mjs [tag]
// With a tag, it has to be `v<version>`. CARGO_TARGET_DIR is honored.
// Windows only: the zip is made with the tar that comes with Windows.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Put next to the program in the portable zip. */
const PORTABLE_README = `YouTube Music Desktop, portable

Start ytmusic-desktop.exe. Nothing is installed.

- Needs the WebView2 runtime, which Windows 10 and 11 normally have.
- Settings and the sign-in to Google are kept in your user profile, as with
  the installed app: %APPDATA%\\io.github.ariazonaa.ytmusic-desktop and
  %LOCALAPPDATA%\\io.github.ariazonaa.ytmusic-desktop. Delete those two to
  remove everything.
- Updates: the settings window says when there is a new version and opens
  the download page. Unpack the new zip over this folder.

https://github.com/Ariazonaa/ytmusic-desktop
`.replace(/\n/g, "\r\n");

const REPOSITORY = "https://github.com/Ariazonaa/ytmusic-desktop";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
// Installed apps take whatever the latest release is. A version like
// 1.2.0-beta.1 would reach all of them, so there are no releases of those.
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} is a pre-release version: not released`);
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
const portable = `ytmusic-desktop_${version}_x64-portable.zip`;
rmSync("release", { recursive: true, force: true });
mkdirSync("release");
copyFileSync(join(bundle, built), join("release", installer));

// The same program the installer puts in place, with a short text beside it.
const folder = mkdtempSync(join(tmpdir(), "ytmusic-portable-"));
copyFileSync(join(bundle, "..", "..", "ytmusic-desktop.exe"), join(folder, "ytmusic-desktop.exe"));
writeFileSync(join(folder, "README.txt"), PORTABLE_README);
const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
execFileSync(tar, ["-a", "-c", "-f", join(process.cwd(), "release", portable), "-C", folder, "ytmusic-desktop.exe", "README.txt"]);
rmSync(folder, { recursive: true, force: true });

const sha256 = (file) => createHash("sha256").update(readFileSync(join("release", file))).digest("hex");
writeFileSync(join("release", "SHA256SUMS.txt"), [installer, portable].map((file) => `${sha256(file)}  ${file}\n`).join(""));
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
console.log(`release/ holds ${installer}, ${portable}, SHA256SUMS.txt, latest.json and notes.md for ${tag}`);

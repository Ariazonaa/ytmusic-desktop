// Puts together what a release consists of, in two steps.
//
// 1. After a build made with
//    `npm run tauri build -- --config src-tauri/tauri.release.conf.json`,
//    on each system:
//
//      node scripts/release.mjs collect
//
//    takes what the build made into release-parts/<system>/, under the names
//    the release uses. On Windows that is the installer and the portable zip,
//    on Linux the .deb and the AppImage. CARGO_TARGET_DIR is honored.
//
// 2. With the parts of every system in release-parts/:
//
//      node scripts/release.mjs [tag]
//
//    writes release/: those files, SHA256SUMS.txt with their checksums,
//    latest.json (what running apps ask for to learn of an update), notes.md
//    (this version's part of CHANGELOG.md) and PKGBUILD for Arch Linux.
//    With a tag, it has to be `v<version>`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPOSITORY = "https://github.com/Ariazonaa/ytmusic-desktop";
const PARTS = "release-parts";

/** Put next to the program in the portable zip. */
const PORTABLE_README = `YouTube Music Desktop, portable

Start ytmusic-desktop.exe. Nothing is installed.

- Needs the WebView2 runtime, which Windows 10 and 11 normally have.
- Settings and the sign-in to Google are kept in your user profile, as with
  the installed app: %APPDATA%\\io.github.ariazonaa.ytmusic-desktop and
  %LOCALAPPDATA%\\io.github.ariazonaa.ytmusic-desktop. Delete those two to
  remove everything.
- Portable mode: put an empty file named "portable" or "portable.txt" in
  this folder. Then everything, the sign-in too, is kept in the folder
  ytmusic-desktop-data here instead, and this folder can be copied around.
  The two folders above are not used then.
- Updates: the settings window says when there is a new version and opens
  the download page. Unpack the new zip over this folder.

${REPOSITORY}
`.replace(/\n/g, "\r\n");

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
// A version like 1.2.0-beta.1 is published as a pre-release: for testers.
// Installed apps ask for releases/latest, which GitHub never points at a
// pre-release; only those with "Also offer test versions" on look for the
// newest release of all (update.rs) and are offered it.
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`unexpected version: ${version}`);
const preRelease = version.includes("-");
// A pre-release has the notes of the version it comes before.
const changelogVersion = version.replace(/-.*/, "");

const names = {
  installer: `ytmusic-desktop_${version}_x64-setup.exe`,
  portable: `ytmusic-desktop_${version}_x64-portable.zip`,
  deb: `ytmusic-desktop_${version}_amd64.deb`,
  appimage: `ytmusic-desktop_${version}_amd64.AppImage`,
};

const bundleDir = (kind) => join(process.env.CARGO_TARGET_DIR ?? "src-tauri/target", "release", "bundle", kind);

/** The one file of this version the build put into `bundle/<kind>`, by its ending. */
function built(kind, ending) {
  const dir = bundleDir(kind);
  const file = existsSync(dir) && readdirSync(dir).find((name) => name.endsWith(ending) && name.includes(`_${version}_`));
  if (!file) throw new Error(`no ${ending} for ${version} in ${dir}`);
  return join(dir, file);
}

/**
 * Copies a .deb with another version in its control file. Debian takes what
 * follows the hyphen in 1.2.0-beta.1 as the package's revision and counts it
 * as later than 1.2.0, so apt would not take the release over the beta. A
 * tilde sorts before everything, even the end: 1.2.0~beta.1 comes before 1.2.0.
 */
function debWithVersion(from, to, debVersion) {
  const temp = mkdtempSync(join(tmpdir(), "ytmusic-deb-"));
  const root = join(temp, "deb");
  execFileSync("dpkg-deb", ["--raw-extract", from, root]);
  // The folder itself becomes "./" in the package, so it gets the usual rights.
  chmodSync(root, 0o755);
  const control = join(root, "DEBIAN", "control");
  const text = readFileSync(control, "utf8");
  if (!/^Version: /m.test(text)) throw new Error(`${from} has no Version in its control file`);
  writeFileSync(control, text.replace(/^Version: .*$/m, `Version: ${debVersion}`));
  execFileSync("dpkg-deb", ["--root-owner-group", "--build", root, to], { stdio: ["ignore", "ignore", "inherit"] });
  rmSync(temp, { recursive: true, force: true });
}

/** The updater's signature of a file, written by the build when it knows the signing key. */
function signature(file) {
  const text = readFileSync(`${file}.sig`, "utf8").trim();
  if (!text) throw new Error(`the signature of ${file} is empty`);
  return text;
}

function collect() {
  if (process.platform === "win32") {
    const out = join(PARTS, "windows");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const setup = built("nsis", "_x64-setup.exe");
    copyFileSync(setup, join(out, names.installer));
    writeFileSync(join(out, `${names.installer}.sig`), signature(setup));

    // The same program the installer puts in place, with a short text beside it.
    const folder = mkdtempSync(join(tmpdir(), "ytmusic-portable-"));
    copyFileSync(join(bundleDir(".."), "ytmusic-desktop.exe"), join(folder, "ytmusic-desktop.exe"));
    writeFileSync(join(folder, "README.txt"), PORTABLE_README);
    const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    execFileSync(tar, ["-a", "-c", "-f", join(process.cwd(), out, names.portable), "-C", folder, "ytmusic-desktop.exe", "README.txt"]);
    rmSync(folder, { recursive: true, force: true });
    console.log(`${out} holds ${names.installer} and ${names.portable}`);
  } else if (process.platform === "linux") {
    const out = join(PARTS, "linux");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    if (preRelease) debWithVersion(built("deb", ".deb"), join(out, names.deb), version.replace("-", "~"));
    else copyFileSync(built("deb", ".deb"), join(out, names.deb));
    const appimage = built("appimage", ".AppImage");
    copyFileSync(appimage, join(out, names.appimage));
    writeFileSync(join(out, `${names.appimage}.sig`), signature(appimage));
    console.log(`${out} holds ${names.deb} and ${names.appimage}`);
  } else {
    throw new Error(`nothing to collect on ${process.platform}`);
  }
}

/** This version's part of the changelog: from its heading to the next one. */
function releaseNotes() {
  const changelog = readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
  const start = changelog.indexOf(`\n## ${changelogVersion}\n`);
  if (start < 0) throw new Error(`CHANGELOG.md has no entry for ${changelogVersion}`);
  const rest = changelog.slice(start + `\n## ${changelogVersion}\n`.length);
  const end = rest.indexOf("\n## ");
  // The changelog wraps its lines; the app shows the notes as they are, so each point becomes one line.
  const notes = (end < 0 ? rest : rest.slice(0, end)).trim().replace(/\n {2,}(?=\S)/g, " ");
  if (!notes) throw new Error(`the entry for ${changelogVersion} in CHANGELOG.md is empty`);
  return preRelease ? `A test version before ${changelogVersion}. Installed apps are offered it only with "Also offer test versions" on in their settings.\n\n${notes}` : notes;
}

function assemble(tag) {
  if (tag !== `v${version}`) throw new Error(`the tag ${tag} does not fit version ${version} in package.json`);
  const notes = releaseNotes();
  const part = (system, name) => join(PARTS, system, name);
  const files = [
    ["windows", names.installer],
    ["windows", names.portable],
    ["linux", names.deb],
    ["linux", names.appimage],
  ];
  for (const [system, name] of files) {
    if (!existsSync(part(system, name))) throw new Error(`${part(system, name)} is missing: collect on ${system} first`);
  }

  rmSync("release", { recursive: true, force: true });
  mkdirSync("release");
  for (const [system, name] of files) copyFileSync(part(system, name), join("release", name));

  const sha256 = (name) => createHash("sha256").update(readFileSync(join("release", name))).digest("hex");
  writeFileSync(join("release", "SHA256SUMS.txt"), files.map(([, name]) => `${sha256(name)}  ${name}\n`).join(""));
  writeFileSync(join("release", "notes.md"), notes + "\n");

  const download = (name) => `${REPOSITORY}/releases/download/${tag}/${name}`;
  const sig = (system, name) => readFileSync(`${part(system, name)}.sig`, "utf8").trim();
  writeFileSync(
    join("release", "latest.json"),
    JSON.stringify(
      {
        version,
        notes,
        pub_date: new Date().toISOString(),
        platforms: {
          "windows-x86_64": { signature: sig("windows", names.installer), url: download(names.installer) },
          // Only the AppImage replaces itself; packages are updated by the system's tools.
          "linux-x86_64": { signature: sig("linux", names.appimage), url: download(names.appimage) },
        },
      },
      null,
      2,
    ) + "\n",
  );

  // For the AUR: the package installs the .deb of this release. Not for a
  // pre-release, whose version is no pkgver.
  if (preRelease) {
    console.log(`release/ holds ${files.map(([, name]) => name).join(", ")}, SHA256SUMS.txt, latest.json and notes.md for the pre-release ${tag}`);
    return;
  }
  const pkgbuild = readFileSync("packaging/aur/PKGBUILD", "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/^pkgver=.*$/m, `pkgver=${version}`)
    .replace(/^pkgrel=.*$/m, "pkgrel=1")
    .replace(/^sha256sums=\(.*\)$/m, `sha256sums=('${sha256(names.deb)}')`);
  writeFileSync(join("release", "PKGBUILD"), pkgbuild);

  console.log(`release/ holds ${files.map(([, name]) => name).join(", ")}, SHA256SUMS.txt, latest.json, notes.md and PKGBUILD for ${tag}`);
}

if (process.argv[2] === "collect") collect();
else assemble(process.argv[2] ?? `v${version}`);

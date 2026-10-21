// Writes the manifests for Windows package managers for a published release:
//
//   node scripts/package-manifests.mjs v1.2.3
//
// reads the release's SHA256SUMS.txt from GitHub and writes to release/manifests/
//
// - scoop/ytmusic-desktop.json: for a Scoop bucket (the portable zip). It
//   updates itself from then on (`checkver`, `autoupdate`).
// - winget/: the three files of a winget-pkgs pull request (the installer),
//   under manifests/a/Ariazonaa/YTMusicDesktop/<version>/ in that repository.
//
// Submitting them is done by hand, see docs/development.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPOSITORY = "https://github.com/Ariazonaa/ytmusic-desktop";
const DESCRIPTION = "YouTube Music as a desktop app, with an equalizer, lyrics, themes, a tray icon, global shortcuts and plugins";

const tag = process.argv[2];
if (!/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag ?? "")) throw new Error("usage: node scripts/package-manifests.mjs v1.2.3");
const version = tag.slice(1);
const download = (name) => `${REPOSITORY}/releases/download/${tag}/${name}`;
const installer = `ytmusic-desktop_${version}_x64-setup.exe`;
const portable = `ytmusic-desktop_${version}_x64-portable.zip`;

/** The checksums of a release, by file name. */
function parseSums(text) {
  const sums = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match) sums.set(match[2], match[1]);
  }
  return sums;
}

const response = await fetch(download("SHA256SUMS.txt"));
if (!response.ok) throw new Error(`${tag}: no SHA256SUMS.txt (${response.status}); is the release published?`);
const sums = parseSums(await response.text());
for (const name of [installer, portable]) if (!sums.has(name)) throw new Error(`SHA256SUMS.txt of ${tag} has no ${name}`);

const out = join("release", "manifests");
mkdirSync(join(out, "scoop"), { recursive: true });
mkdirSync(join(out, "winget"), { recursive: true });

const scoop = {
  version,
  description: DESCRIPTION,
  homepage: REPOSITORY,
  license: "MIT",
  notes: "Settings and the sign-in are kept in %APPDATA% and %LOCALAPPDATA%, outside the Scoop folder.",
  architecture: { "64bit": { url: download(portable), hash: sums.get(portable) } },
  bin: "ytmusic-desktop.exe",
  shortcuts: [["ytmusic-desktop.exe", "YouTube Music Desktop"]],
  checkver: "github",
  autoupdate: {
    architecture: {
      "64bit": { url: `${REPOSITORY}/releases/download/v$version/ytmusic-desktop_$version_x64-portable.zip` },
    },
    hash: { url: `${REPOSITORY}/releases/download/v$version/SHA256SUMS.txt` },
  },
};
writeFileSync(join(out, "scoop", "ytmusic-desktop.json"), JSON.stringify(scoop, null, 2) + "\n");

const id = "Ariazonaa.YTMusicDesktop";
const header = (type) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.1.12.0.schema.json\n\n`;
const files = {
  [`${id}.yaml`]: `${header("version")}PackageIdentifier: ${id}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.12.0
`,
  [`${id}.installer.yaml`]: `${header("installer")}PackageIdentifier: ${id}
PackageVersion: ${version}
InstallerType: nullsoft
Scope: user
InstallModes:
  - silent
  - silentWithProgress
UpgradeBehavior: install
Dependencies:
  PackageDependencies:
    - PackageIdentifier: Microsoft.EdgeWebView2Runtime
Installers:
  - Architecture: x64
    InstallerUrl: ${download(installer)}
    InstallerSha256: ${sums.get(installer).toUpperCase()}
ManifestType: installer
ManifestVersion: 1.12.0
`,
  [`${id}.locale.en-US.yaml`]: `${header("defaultLocale")}PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Ariazonaa
PublisherUrl: https://github.com/Ariazonaa
PackageName: YouTube Music Desktop
PackageUrl: ${REPOSITORY}
License: MIT
LicenseUrl: ${REPOSITORY}/blob/main/LICENSE
ShortDescription: ${DESCRIPTION}.
Tags:
  - youtube-music
  - music
  - music-player
  - equalizer
  - lyrics
ReleaseNotesUrl: ${REPOSITORY}/releases/tag/${tag}
ManifestType: defaultLocale
ManifestVersion: 1.12.0
`,
};
for (const [name, text] of Object.entries(files)) writeFileSync(join(out, "winget", name), text);
console.log(`${out} holds the Scoop manifest and the winget manifests for ${tag}`);

# Development

How to build the app, how it is put together and what was measured. For
writing plugins see [plugins.md](plugins.md), for other systems than Windows
[platforms.md](platforms.md).

## Setup

Requirements: Rust (stable), Node 22+, and the WebView2 runtime (part of Windows 11).

```sh
npm install
npm run dev            # run the app for development
npm run tauri build    # build the installer
```

While `npm run dev` runs, edits take effect without restarting the app:

| Edited | What happens |
| --- | --- |
| Code that runs in the YouTube Music page (`src/core`, `src/inject`, built-in plugins) | the page reloads with the rebuilt script |
| The settings window (`src/ui`) | the open window updates in place |
| The plugin sandbox script (`src/sandbox`) | external plugins restart with it |
| Rust code (`src-tauri`) | the app is rebuilt and restarted |

The first and third rows need Windows. Development builds load these scripts
from `dist-inject` on disk; release builds embed them.

Checks:

```sh
npm test               # Vitest
npm run typecheck      # tsc (strict) and svelte-check
cd src-tauri
cargo test
cargo clippy --all-targets -- -D warnings
```

These checks also run for every pull request and for everything that lands on
`main`, on GitHub (`.github/workflows/ci.yml`) and on a Gitea server
(`.gitea/workflows`, the same jobs): the TypeScript
checks on a Linux runner, the Rust checks on a Windows runner and, without
the formatting check, on Linux too. From `main`
the Windows installer is built as well and attached to the run as an
artifact.

A second workflow, `audit.yml`, checks the npm packages and Rust crates for
known security holes every Monday and whenever a lock file changes.

Two tests run against the real app, because they cover what only happens
there:

- `scripts/e2e-transition.mjs`: a track ending and the next one starting by
  itself. YouTube Music plays both through one media stream, so the `<video>`
  clock keeps counting and the element may be swapped. The test checks that
  plugins still get the new song once, its position and duration, and that
  sound still passes through the audio chain.
- `scripts/e2e-startup.mjs`: the app is closed and started again. The track
  from last time has to come back, paused at its position, and a launch as at
  sign-in must open no window when "start in the tray" is on.

```sh
npm run tauri build -- --no-bundle
npm run test:e2e       # both, about two minutes, Windows only
```

They need the app closed and a network connection. They use the app's normal
profile: parts of a few tracks are played, silently, and show up in the watch
history of a signed-in account. Settings and the remembered track are put back
afterwards. `YTMD_EXE` points them at another build, `YTMD_E2E_PORT` at
another port than 9333.

The version is maintained in `package.json`. `npm version <new>` copies it to
the Rust side; the app's configuration reads it from there. What changed for
users goes into [CHANGELOG.md](../CHANGELOG.md), and a test fails if the current
version has no entry.

## Releases and updates

A release is made by a tag:

```sh
npm version 1.2.3          # also needs an entry in CHANGELOG.md
git commit -am "Version 1.2.3" && git push
git tag v1.2.3 && git push origin v1.2.3
```

`.github/workflows/release.yml` then builds the app on Windows and on Linux
(Ubuntu 22.04, so that the AppImage also runs on older systems). On each,
`node scripts/release.mjs collect` takes what the build made; a last job puts
it together with `node scripts/release.mjs <tag>` and publishes:

| File | For |
| --- | --- |
| `ytmusic-desktop_<v>_x64-setup.exe` | Windows, the installer |
| `ytmusic-desktop_<v>_x64-portable.zip` | Windows, the same program with a short `README.txt` |
| `ytmusic-desktop_<v>_amd64.deb` | Debian, Ubuntu and others with apt |
| `ytmusic-desktop_<v>_amd64.AppImage` | any Linux; brings GStreamer along |
| `SHA256SUMS.txt` | checksums of the four |
| `latest.json` | what running apps ask for, see below |
| `PKGBUILD`, `SRCINFO` | Arch Linux: the package `ytmusic-desktop-bin`, which installs the .deb |

A tag with a pre-release version, like `v1.2.0-beta.1` after
`npm version 1.2.0-beta.1`, is published as a pre-release for testers: with
the notes of 1.2.0 and without the Arch Linux package. Installed apps are not
updated to it, as GitHub's `releases/latest` never points at a pre-release.

The release's text is the version's part of the changelog. After publishing,
a job on Arch Linux builds the package from the published .deb, which also
checks its checksum, and attaches `PKGBUILD` and `SRCINFO`. To put a version
on the AUR, copy both into the AUR repository of `ytmusic-desktop-bin`
(`SRCINFO` as `.SRCINFO`) and push; that needs an AUR account with an SSH key.

For Windows package managers, `node scripts/package-manifests.mjs <tag>` reads
the published release's `SHA256SUMS.txt` and writes to `release/manifests/`:

- `scoop/ytmusic-desktop.json`, the portable zip, for a Scoop bucket such as
  [Extras](https://github.com/ScoopInstaller/Extras) (pull request to its
  `bucket/` folder). It updates itself from then on.
- `winget/`, the installer, for
  [winget-pkgs](https://github.com/microsoft/winget-pkgs): the three files go to
  `manifests/a/Ariazonaa/YTMusicDesktop/<version>/` in a pull request. Check
  them first with `winget validate --manifest release/manifests/winget`.

Both want a regular release, not a pre-release.

`.github/workflows/linux-packages.yml` checks the Linux packages on every push:
it installs the .deb on Ubuntu 24.04 and the package built from `PKGBUILD` on
Arch Linux, starts them and the AppImage on a virtual screen with a link to a
track (`scripts/linux-smoke.sh`) and keeps screenshots taken after 20, 45 and
70 seconds as an artifact.

Not every copy can replace itself: a portable copy on Windows (the updater
would run the installer and leave the copy as it was) and the packages on
Linux, which their package manager updates. The app tells them apart by the
`uninstall.exe` the installer puts next to the program on Windows, and by
`APPIMAGE`, which the AppImage's runtime sets, on Linux. Where it cannot
replace itself, the settings window offers the download page instead of
installing.

`latest.json` is how installed apps learn of the update: they fetch
`releases/latest/download/latest.json`, which names the version, the
addresses of the Windows installer and the AppImage, and their signatures. The app installs an update only if the
signature fits the public key in `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`). The private key is not in the repository: the
workflow reads it from the secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Whoever has it can publish updates that
every installed app accepts, and without it no update can be published for
them, so it has to be kept both secret and safe.

A release can be made by hand as well, with the key: build with
`--config src-tauri/tauri.release.conf.json` and the two variables set, on
Windows and on Linux, run `node scripts/release.mjs collect` on each, copy
both `release-parts` folders together, run `node scripts/release.mjs` and
publish a release for the tag `v<version>` with the files from `release`.
The workflow sees that release and does nothing.

An ordinary `npm run tauri build` needs no key: only
`--config src-tauri/tauri.release.conf.json` asks for the signature. The
code is in `src-tauri/src/update.rs`; development builds do not look for
updates at start.

## Architecture

```
Rust (src-tauri)                         WebView2: https://music.youtube.com
┌──────────────────────────┐            ┌─────────────────────────────────────┐
│ settings.rs  load/save   │◄──invoke───│ inject.js (initialization script)   │
│ commands.rs  get/set     │            │  ├ core/injector   CSS, DOM helpers │
│ window.rs    window,     │──inject───►│  ├ core/player     song detection   │
│              navigation  │            │  ├ core/plugin-manager  lifecycle   │
└──────────────────────────┘            │  └ plugins/*                        │
                                        └─────────────────────────────────────┘
```

- The main window navigates straight to YouTube Music. Vite bundles
  `src/inject/main.ts` into one IIFE, which Rust embeds and runs on every
  navigation before the page's own scripts.
- The injected script only starts on `music.youtube.com`, not on the Google
  sign-in or consent pages the window also visits.
- The page may call exactly twelve backend commands
  (`src-tauri/capabilities/ytm.json`): `get_settings`, `set_settings`,
  `open_settings`, `list_external_plugins`, three for the
  [files to share](../README.md#sharing-themes-and-presets) (`list_shared`, `save_shared`,
  `open_shared_folder`), `set_now_playing` for the tray, `log_error` for
  the log, `notify` for notifications, which the backend spaces out,
  `report_health` for what does not work, and `output_device` for the name
  of the device sound goes to. Every other Tauri API is denied to it;
  installing and removing plugins is for the settings window only.
- External plugins never run in the page. Each one gets a hidden, sandboxed
  iframe served from its own scheme, see [External plugins](plugins.md#external-plugins).
- The settings window is the only UI the app serves itself: a Svelte and
  Tailwind page in `src/ui`, built to `dist-ui`.
- YouTube and Google sign-in stay in the window. Other links open in the
  default browser.

## The settings file

`%APPDATA%\io.github.ariazonaa.ytmusic-desktop\settings.json`:

```json
{
  "plugins": ["lyrics", "demo"],
  "startup": false,
  "startInTray": false,
  "minimizeToTray": true,
  "resumePlayback": true,
  "language": "system",
  "reloadPluginsOnChange": false,
  "hardwareAcceleration": true,
  "checkForUpdates": true,
  "shortcuts": { "playPause": "Ctrl+Alt+Shift+F9", "next": "", "previous": "", "volumeUp": "", "volumeDown": "", "toggleMute": "" },
  "pluginSettings": { "demo": { "accentColor": "blue" } }
}
```

| Key | Effect |
| --- | --- |
| `plugins` | the enabled plugins |
| `startup` | launch the app at sign-in (release builds only) |
| `startInTray` | a launch at sign-in opens no window |
| `minimizeToTray` | closing the window hides it to the tray and playback continues |
| `resumePlayback` | load the track from last time at start, paused where it stopped |
| `language` | language of the settings window, the tray menu and the app's parts of the page: `system`, `en` or `de` |
| `reloadPluginsOnChange` | for plugin authors: restart the external plugins when a file in the plugins folder changes |
| `hardwareAcceleration` | draw and decode video on the GPU; off saves about 150 MB, applies from the next start |
| `checkForUpdates` | ask the project's releases at each start whether there is a newer version |
| `shortcuts` | global shortcuts, written like `Ctrl+Alt+ArrowUp`; empty is off |
| `pluginSettings` | per-plugin settings the user changed, by plugin name |

The file is read at start; use the settings window to change settings while
the app runs. An invalid file is moved to `settings.json.bak` and replaced by the
defaults.

## How the crossfade works

YouTube Music has one player, so the next track cannot be started early.
The `crossfade` plugin finishes the current one early instead, unnoticed:

1. The player runs a few percent fast, with pitch correction off.
2. Its sound passes a delay that grows at the matching pace, which slows it
   down again. The two cancel exactly, but the player gets ahead of what is
   heard, by the length of the crossfade when the track ends.
3. Those last seconds are then still in the delay. They play out and fade
   while the next track, which the player has already started, fades in.

Measured in the app with test tones: the player at 2.6 % and at 8.7 % too fast
both came out at the original frequency. The resampling is not free, and it
costs more the higher the tone. What appears besides the tone, relative to
it, with the audio chain at its sample rate of 192 kHz:

| Tone | Besides the tone |
| --- | --- |
| 1 kHz | 57 to 62 dB lower |
| 5 kHz | 43 to 48 dB lower |
| 10 kHz | 37 to 41 dB lower |
| 15 kHz | 33 to 38 dB lower |

At the usual 48 kHz these were 54, 32, 19 and 10 dB, which is why the chain
runs at four times that rate. A cleaner converter would need an audio
worklet, which the page's security policy does not let the app load. None of
this has been judged by ear.

What it costs:

- The picture of a music video runs ahead of the sound by up to the
  crossfade's length. The time shown and the progress bar are corrected to
  what is heard.
- With the equalizer, the compressor and the crossfade on, the app used 92 MB
  more memory and 15 instead of 9 % of one processor core.
- Pausing and seeking drop what is in the delay. After a pause the player
  goes back to what was last heard. After a seek the overlap has to build up
  again, at most 8 % of the time played, so a track change soon after a seek
  overlaps for less than configured.
- Positions reported to plugins describe what is heard, so lyrics stay in
  time.

## Measurements

Release build on Windows 11, signed in, one plugin enabled.

| | Measured | Goal |
| --- | --- | --- |
| Start until the UI and plugins are ready | 1.65 s from a local disk, warm cache (3 runs) | < 3 s |
| App process, without WebView2 | 5 MB private, 27 MB working set | < 50 MB |
| In the tray, playing: working set | 286 to 296 MB after a minute | < 350 MB |
| Window open, playing: private memory | 530 to 620 MB | < 650 MB |
| Installer | 2.2 MB | |

Started from a network share, the window alone took 5.8 s to appear.

### Compared with Pear

Measured on 2026-10-15 in Windows Sandbox (8 GB, vGPU on), so that both apps
start from nothing: signed out, default settings, cookies declined. Each app
was started, left for a minute and measured idle, then played music video
`dQw4w9WgXcQ` muted for a minute and was measured again, then minimized, then
its window was closed. A measurement sums private bytes and working set of the
app's process and every process below it (WebView2's or Electron's), six
samples five seconds apart. The page was driven over the DevTools protocol.

| | ytmusic-desktop 0.6.4 | Pear 3.12.0 |
| --- | --- | --- |
| Installer, x64 | 3.8 MB (zip 5.2 MB) | web installer 0.7 MB, fetches 108 MB; full installer 274 MB |
| On disk | 15.8 MB | 396.0 MB |
| Idle: private / working set | 367 / 616 MB, 7 processes | 551 / 845 MB, 5 processes |
| Playing | 497 / 780 MB, 9 processes | 604 / 877 MB, 5 processes |
| Minimized, playing | 500 / 785 MB | 607 / 880 MB |
| Window closed, playing | in the tray | quits |

What to keep in mind:

- WebView2 is part of Windows, so its files are not in the 15.8 MB; Pear's 396
  MB include its Chromium. On a PC both apps run on a Chromium either way.
- The sandbox registers WebView2 differently from a normal Windows: the
  installer of ytmusic-desktop stops there (it tries to install WebView2,
  which needs administrator rights), and the WebView2 loader ignores
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`. So the portable program was run
  with `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`, from a build that differed from
  0.6.4 only by `--remote-debugging-port` in its browser arguments.
- Signed out and without the `adblock` plugin, ytmusic-desktop played an ad
  before the track; Pear did not. The playing values include that.
- In the tray the working set drops because WebView2 is told to give memory
  back (see "Where the memory goes"). The sandbox run of that step did not get
  the track playing; on a Windows 11 PC, signed out with default settings,
  playing in the tray measured 460 MB private and 202 MB working set.

### Playback

Checked with a Premium account on Windows 11:

- No ads are requested. Without Premium there are ads between tracks; the
  `adblock` plugin removes them.
- Audio plays in the high quality tier: AAC at 256 kbit/s. Opus at about
  270 kbit/s is offered too; the player picks AAC unless the `prefer-opus`
  plugin is on.
- Widevine is available in WebView2 at the software level
  (`SW_SECURE_CRYPTO`), and so is PlayReady. Hardware-backed Widevine levels
  are not.
- Decryption works: a public Widevine-protected test stream played inside the
  app, with the license requested and the keys reported usable. The YouTube
  Music tracks checked were not encrypted, so this was not seen on YouTube
  Music itself.

### Where the memory goes

Nearly all of it belongs to the YouTube Music page, not to the shell. Typical
private memory while playing, by WebView2 process:

| Process | Private memory |
| --- | --- |
| Renderer (the page and the plugins) | 225 to 265 MB |
| GPU process (drawing, video decoding) | 180 to 240 MB |
| Browser process | 45 MB |
| Network, audio and storage services | 30 MB |
| App process (Rust) | 5 MB |

The original goal of 150 MB at idle assumed the shell was the cost. It cannot
be met while the page itself needs several times that, so the goals above
replace it: keep the shell negligible, and keep the app small where a music
player spends its time, in the tray.

Readings vary by about 100 MB between runs. Chromium's low-end device mode
and GPU rasterization switches made no difference beyond that.

Turning off "Hardware acceleration" in the settings window removes most of the
GPU process. Measured twice each while a 360p music video played:

| Hardware acceleration | Private memory | Processor time |
| --- | --- | --- |
| On (default) | 464 and 475 MB | 7 and 8 % of one core |
| Off | 320 and 321 MB | 10 % of one core |

No extra frames were dropped. That was on a fast desktop processor; on a
weaker one, or with higher video resolutions, drawing and decoding on the
processor will cost more, which is why acceleration stays on by default.

In the tray the app tells WebView2 that the page is not visible and asks it
to keep memory low. Windows then takes back the pages that are not in use:
the working set falls from about 790 MB to under 300 MB within a minute while
the music keeps playing. The private memory stays reserved, so tools that
show committed memory report no change.

External plugins cost one extra process in total, not one each. The first
enabled plugin started a process of 19 MB private memory (45 MB working set);
enabling two more started none. The plugins share that process, which is
separate from the one running the YouTube Music page. From each other they are
separated by their distinct origins, as web pages in one browser process are.

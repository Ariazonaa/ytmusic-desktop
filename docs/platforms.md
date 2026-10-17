# Linux and macOS

The app is made and tested mostly on Windows. As of 2026-10-17:

## The short version

- **Linux: released, from 0.7.0,** as .deb, AppImage and a package for Arch
  Linux. Every push starts all three on a virtual screen
  (`.github/workflows/linux-packages.yml`): the app starts, YouTube Music and
  the app's own parts (gear button, settings window) are there, and a track
  plays signed out, also with the `adblock` plugin on. Not tried yet: signing
  in with Google, Premium, sound on a real audio device, tray and global
  shortcuts on a real desktop.
- **macOS is unknown.** There is no Mac to test on. Nothing found so far rules
  it out.

## The app on Linux

What differs from Windows:

- The webview is WebKitGTK, which has no Widevine: a track that needs DRM
  would not play. Ordinary playback does not, see below.
- The app sends a Chrome user agent, since YouTube Music turns WebKitGTK's own
  away (`LINUX_USER_AGENT` in `window.rs`).
- Not on Linux: giving memory back in the tray (`background.rs`), the app's
  own page when there is no connection (`offline.rs`), the output device's
  name for the equalizer's presets (`audio_device.rs`) and cancelling a plugin
  frame's navigation in the backend (`frames.rs`). External plugin execution is
  disabled because detecting a second load cannot prevent data leaving the frame. The hardware acceleration switch does nothing there.
- Updates: the AppImage replaces itself like the Windows version. The .deb and
  the Arch package are updated by their package manager; the settings window
  only points to the download page.
- The .deb depends on the GStreamer plugin packages (`good`, `bad`, `libav`)
  and the Arch package on their Arch counterparts; the AppImage brings
  GStreamer along.

## The probe before the port

On Ubuntu 24.04 with WebKitGTK 2.52.6, the webview Tauri uses on Linux
(`scripts/linux-probe.py`, run by the `Linux probe` workflow):

| Question | Result |
| --- | --- |
| Does YouTube Music load? | Yes, with a Chrome user agent, as the app sends on Windows. |
| Does a track play? | Yes: 9.7 s played within the probe, no media error, no `encrypted` event. |
| Media Source Extensions | available |
| AAC, Opus, H.264, VP9 | all supported, with the GStreamer plugin packages installed |
| Encrypted media (EME) | not there at all: no Widevine, no ClearKey |
| Web Audio, `adoptedStyleSheets` | available; the audio plugins and CSS injection build on them |
| `cargo clippy` and `cargo test` | pass without changes |

The tracks checked on Windows were not encrypted either (see Playback in
[development.md](development.md#playback)), which fits: ordinary YouTube Music playback does not go through DRM.

## Still open on Linux

- **Signing in.** Google refuses sign-in from some embedded webviews; on
  Windows it works. Not tried on Linux yet.
- **Premium playback.** Whether a signed-in Premium account gets the same
  quality and no DRM-only content.
- **Sound, tray, shortcuts.** The CI runners have no audio device and no
  desktop; the audio chain asks for 192 kHz, which was only tried in WebView2.
- **External plugins are disabled.** The custom protocol returns 403 until
  native frame isolation is active. Linux and macOS do not implement that guard;
  installed plugins are listed as unavailable. Built-in plugins still work.
- **Tests.** The end-to-end test and the measurements in
  [development.md](development.md) drive the app over the Chrome DevTools
  protocol, which WebKitGTK does not speak; on Linux there are only the
  screenshots.
- **Ads.** Once, on Arch, an ad before the track stayed paused until the test
  ended; in the next run the ad played and the track after it.

## macOS

Not tested. What is known without a Mac:

- Tauri uses WKWebView there, which like WebKitGTK has no Widevine. Since
  playback did not need DRM on Windows or Linux, that alone should not block
  it.
- WKWebView is stricter about starting media without a user gesture than the
  other two.
- The same open questions as on Linux apply, sign-in first.

## If neither works out

Tauri has a runtime based on the Chromium Embedded Framework in development.
It would bring the same engine as on Windows to all three systems, DRM
included once a Widevine-enabled build is used, at the price of shipping a
browser with the app (well over 100 MB instead of 2.5 MB). Its state was not
examined closely here.

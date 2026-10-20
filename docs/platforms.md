# Linux and macOS

The app is made and tested mostly on Windows. As of 2026-10-16:

## The short version

- **Linux: released, from 0.7.0,** as .deb, AppImage and a package for Arch
  Linux. Every push starts all three on a virtual screen
  (`.github/workflows/linux-packages.yml`): the app starts, YouTube Music and
  the app's own parts (gear button, settings window) are there, and a track
  plays signed out, also with the `adblock` plugin on. A tester uses it on
  Arch (CachyOS) with a Premium account, signed in with a security key. The
  tray, global shortcuts and the volume were checked on virtual machines
  with Arch, Fedora and Debian (XFCE).
- **macOS is unknown.** There is no Mac to test on. Nothing found so far rules
  it out.

## The app on Linux

What differs from Windows:

- The webview is WebKitGTK, which has no Widevine: a track that needs DRM
  would not play. Ordinary playback does not, see below.
- The app sends Safari's user agent as GNOME Web does (`LINUX_USER_AGENT` in
  `window.rs`). YouTube Music turns WebKitGTK's own away, and with Chrome's
  YouTube's bot check fails in WebKit and playback stops after about a minute.
- Not on Linux: giving memory back in the tray (`background.rs`), the app's
  own page when there is no connection (`offline.rs`), the output device's
  name for the equalizer's presets (`audio_device.rs`). The hardware
  acceleration switch does nothing there.
- Security keys: WebKitGTK has no Web Authentication, so Google's sign-in
  would wait forever at "Use your security key". On `accounts.google.com`
  the injected script stands in for `navigator.credentials.get`
  (`injector/webauthn.ts`), and the app asks the key over USB with the
  `authenticator` crate Firefox uses (`webauthn.rs`). The app does the
  browser's checks: the origin is the one the window shows, and the page may
  ask only for its own site or Google's old U2F App ID. Only that page may
  call it, through a capability of its own that exists on Linux only. A key's
  PIN is asked in a dialog in the page.
- Leaving a page: when a page asks before it is left, WebKitGTK shows its own
  dialog with the page's return value as the message, "false" on signing out
  of YouTube Music. The main window answers "leave" instead
  (`leave_without_asking` in `window.rs`); alerts and the like are unchanged.
- Plugin frames: WebKitGTK asks the window's navigation handler about frames
  too, without saying which. So on Linux that handler opens no page outside the
  app in the browser and stops the navigation instead (`in_window` in
  `window.rs`); on Windows `frames.rs` watches each frame. On macOS nothing
  does, and plugins from others do not run there.
- Updates: the AppImage replaces itself like the Windows version. The .deb and
  the Arch package are updated by their package manager; the settings window
  only points to the download page.
- The .deb depends on the GStreamer plugin packages (`good`, `bad`, `libav`)
  and the Arch package on their Arch counterparts; the AppImage brings
  GStreamer along. The app also needs libudev for security keys, which every
  distribution with systemd has; building needs its headers (`libudev-dev`).

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

- **Signing in.** A tester signed in on Arch (CachyOS), also with a security
  key. Other distributions not yet.
- **Premium.** A tester uses the app with a Premium account on Arch
  (CachyOS). The sound quality and tracks that may need DRM were not checked
  separately.
- **Sound, tray, shortcuts.** The CI runners have no audio device and no
  desktop; the audio chain asks for 192 kHz, which was only tried in WebView2.
- **External plugins** are served from `ytmd-plugin://localhost` instead of
  `http://ytmd-plugin.localhost`. The code handles both; tried on Arch, Fedora
  and Debian.
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

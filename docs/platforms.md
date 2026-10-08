# Linux and macOS

The app is built and tested on Windows. This is where a port stands, as of
2026-10-07.

## The short version

- **Linux looks feasible.** The original worry, no Widevine in WebKitGTK,
  turned out not to block playback: YouTube Music played a track in WebKitGTK
  without any DRM, and the Rust code builds and passes its tests on Linux
  unchanged. What is still unknown needs a real Linux desktop, see below.
- **macOS is unknown.** There is no Mac to test on. Nothing found so far rules
  it out.

## What was measured on Linux

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

## What this does not show

- **Signing in.** The probe was not signed in. Google refuses sign-in from
  some embedded webviews; on Windows it works. This is the biggest open
  question.
- **Premium playback.** Whether a signed-in Premium account gets the same
  quality and no DRM-only content. A track that does need Widevine would not
  play, and nothing in WebKitGTK can change that.
- **The app itself.** The probe is a bare webview. The injected script,
  plugins, the page's access to the backend, the tray icon, global shortcuts
  and the external plugin frames were not run on Linux.
- **Sound.** The runner has no audio device. The audio chain asks for 192 kHz,
  which was only tried in WebView2.

## What a Linux port would need

Known from the code:

- Memory saving in the tray (`background.rs`) and the development reload
  (`dev_inject.rs`) use WebView2 APIs. Both already fall back to doing nothing
  elsewhere.
- The page shown without a connection (`offline.rs`) is put in place through a
  WebView2 event. Elsewhere the webview's own error page shows.
- The hardware acceleration setting passes a Chromium flag; WebKitGTK needs
  its own switch or the setting hidden.
- External plugins are served from `ytmd-plugin://localhost` instead of
  `http://ytmd-plugin.localhost`. The code handles both, untested.
- The end-to-end test and all measurements in [development.md](development.md) drive the app over
  the Chrome DevTools protocol, which WebKitGTK does not speak.
- Packaging: the bundle targets only list the Windows installer.
- Users need the GStreamer plugin packages (`good`, `bad`, `libav`); without
  them the codecs above are missing.

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

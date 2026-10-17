# Security review: 0.9.0-beta.1

Review base: `d50acbce3e594fba25a42c30c1fd222074b240f2` (`v0.9.0-beta.1`), 2026-10-17.
This is a scoped source review and targeted verification, not a security certification
or a full binary audit. No user account, credentials or private listening data were used.
The app is a local desktop application. External content and user-installed plugins are
trust boundaries; the optional OBS endpoint binds to loopback, not the public network.

## Fixed in this change

### External CSS bypassed network permissions — medium

A user-installed, enabled external plugin with `music.read` and `ui.inject`, but no
`network` permission or allowed hosts, could request a CSS background image from an
arbitrary host and include the current track in its URL. The external message handler
passed CSS to the main page's `adoptedStyleSheets`; the iframe's CSP did not govern
those requests. Direct `ytmd.net` requests were correctly refused.

An isolated harness built the actual plugin bridge, permission API, CSS injector and
sandbox bootstrap. With synthetic track data, Chromium and native WebKitGTK 2.52.5
both attempted the image request. The parent CSP matched the directives returned by
an unauthenticated YouTube Music request. A negative control without `ui.inject`
refused the CSS operation.

External `ui.injectCss` now rejects with an explicit error, even with `ui.inject` and
`network`. External plugins can still style their own document, show panels and use
permitted controls. Built-in CSS injection is unchanged. Post-fix browser checks
confirmed a successful `music.read` response and explicit CSS rejection with no image
request, so merely failing to start the plugin could not satisfy the check.

### Plugin execution did not require native frame isolation — medium

Linux/macOS had no native frame navigation guard. Removing an iframe after its second
`load` happens too late to prevent a request carrying data. WebKit also lacks the
Trusted Types enforcement used by the plugin HTML sanitizer. Windows previously
logged native hook-registration errors and continued.

Plugin resource serving and executable frame URLs now depend on an initially-false
managed readiness flag. Windows sets it only after registering native enforcement;
Linux/macOS leave it false. The app starts on a blank page and registers enforcement
before opening YouTube Music. Settings and the injected loader share the rejection
path for unavailable external plugins; built-in plugins remain available.

On Windows, navigation is cancelled before inspection and only explicitly allowed
navigation is released. Native callback failures revoke readiness and close the
native controller immediately. If that close itself fails, the process exits rather
than continuing without enforcement. Initial registration failure leaves ordinary
playback available, with external plugins disabled.

Native Windows behavior still needs execution testing. Source review established
callback ownership and dispatch ordering; Linux unit tests establish resource/listing
gating and readiness revocation, not WebView2 event semantics.

### Playlist CSV could contain spreadsheet formulas — medium, user interaction

A song title such as `=1+1` appeared at the beginning of a CSV cell unchanged. CSV
quote escaping does not force spreadsheets to interpret such content as text. This
requires exporting a playlist and opening it with formula interpretation enabled;
it is not automatic code execution inside the app.

The serializer now prefixes formula-like cells with an apostrophe before ordinary
CSV escaping, including formula markers preceded by whitespace/control characters.
Tests cover all metadata columns and preserve ordinary CSV quoting and TXT export.

### Resource bounds at the local server and cover downloader

The optional OBS loopback server now shares a maximum of eight active connections
across restarts. A reservation is released when its handler exits, including when
thread creation fails. Reads have a five-second timeout and the complete response
write has a five-second monotonic deadline. Live socket tests verify ninth-client
rejection and recovery after clients leave; deadline tests check expired writes, a real blocked socket,
and complete normal responses. This addresses local resource exhaustion, not a
public inbound service.

Notification images now stop and cancel after exceeding 1 MiB, allow at most four
simultaneous downloads per webview, and abort after ten seconds. Redirects are
refused; cookies and referrers remain omitted. Tests exercise excess stream data,
concurrent requests, slot reuse after completion, failures, and timeout. The
previous implementation read the entire body before applying its size limit.

## Remaining findings and limits

- **Dependency advisory:** OSV lookup of all 537 registry packages in `Cargo.lock`
  found `glib 0.18.5` affected by
  [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), an unsound
  string-variant iterator fixed in glib 0.20. No direct application use of that iterator
  was found, and transitive exploitability was not established. Updating glib requires
  coordinating the GTK/Tauri dependency stack; forcing a semver-incompatible override
  is not part of this change. Four other packages had maintenance notices, not newly
  established exploitable vulnerabilities: proc-macro-error, zbus_names, zvariant and
  zvariant_derive. npm audit reported zero advisories at review time.
- **Native/desktop verification:** no Windows or macOS runtime test, account login,
  Premium playback, real audio hardware, tray or global-shortcut test was performed.
  Windows cross-check was attempted but cc-rs could not find
  `x86_64-w64-mingw32-gcc`; an LLVM cross-compiler attempt then stopped at missing
  MinGW C runtime headers (`assert.h`). Windows CI remains necessary before merging.
- **Binary provenance:** the downloaded AppImage matched the release SHA-256 checksum.
  This detects transfer mismatch, not publisher compromise or source-to-binary
  equivalence. The AppImage was listed as an archive and was not executed. Automatic
  updates use Tauri's signature-verifying updater; signature enforcement was reviewed
  in source, not adversarially exercised against a live installation.

## Compatibility and rollback

Third-party plugins on Linux/macOS are unavailable until native enforcement exists.
On Windows, third-party plugins using parent-page CSS must move their styles into
their own iframe. Native enforcement failure can close the music view; restarting
is required. CSV formula-like values gain a leading apostrophe.

This change does not publish an update or modify installed application data. Reverting
the commits restores previous behavior, including the documented security gaps; no
settings/schema migration or data rollback is needed.

## Verification results

All passing checks below were rerun after restoring the mutation tests.

| Check | Exit | Result |
| --- | --- | --- |
| `npm test` | 0 | 65 files, 523 tests passed |
| `npm run typecheck` | 0 | no errors or warnings |
| `npm run build` | 0 | injection, sandbox and settings bundles built |
| `node scripts/check-plugin-list.mjs` | 0 | one listed plugin, usable manifest |
| `npm audit --ignore-scripts --audit-level=moderate` | 0 | zero reported npm vulnerabilities |
| `cargo test --locked` (in `src-tauri`) | 0 | 102 Rust tests passed; binary/doc test targets also passed |
| `cargo clippy --locked --all-targets -- -D warnings` | 0 | no warnings |
| `cargo fmt --check` | 0 | formatting passed |
| `git diff --check` | 0 | no whitespace errors |

Temporary mutations each caused the intended assertion failure, rather than a
compiler/import failure: remove CSV neutralization (exit 1), bypass protocol
readiness (101), remove socket write timeout (101), remove image concurrency cap
(1), remove image streaming byte limit (1), and remove image abort timer (1).
The blocked-write mutation required the watchdog to close the peer after 2.000 s,
exceeding the test's one-second upper bound; the normal 20 ms deadline passes.
Original source was restored after every mutation.

Browser fixtures used the actual bridge/API/bootstrap with synthetic data. Chromium
and native WebKitGTK reproduced CSS egress before the fix and returned explicit CSS
rejection after it while successful music reads confirmed the plugin was running.
These are component integration checks, not execution of the downloaded AppImage.
Independent source reviews covered the native lifecycle and full change, followed
by focused review of the socket test and mutation output. Windows runtime behavior
and binary reproducibility remain unverified as described above.

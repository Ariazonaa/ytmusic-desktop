# YouTube Music Desktop

A light, extensible desktop client for YouTube Music that keeps the original
web UI. A Tauri 2 shell loads `music.youtube.com` and injects a plugin runtime
into the page.

Status: phase 1 (core and injection). Windows only for now.

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
users goes into [CHANGELOG.md](CHANGELOG.md), and a test fails if the current
version has no entry.

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
  [files to share](#files-to-share) (`list_shared`, `save_shared`,
  `open_shared_folder`), `set_now_playing` for the tray, `log_error` for
  the log, `notify` for notifications, which the backend spaces out,
  `report_health` for what does not work, and `output_device` for the name
  of the device sound goes to. Every other Tauri API is denied to it;
  installing and removing plugins is for the settings window only.
- External plugins never run in the page. Each one gets a hidden, sandboxed
  iframe served from its own scheme, see [External plugins](#external-plugins).
- The settings window is the only UI the app serves itself: a Svelte and
  Tailwind page in `src/ui`, built to `dist-ui`.
- YouTube and Google sign-in stay in the window. Other links open in the
  default browser.

## Desktop integration

- **Settings window:** opened with the gear button in the YouTube Music
  navigation bar or from the tray menu. Changes are saved at once, and plugins
  are switched on and off without a restart.
- **First start:** no plugin is switched on. The settings window opens by
  itself and says where to choose some.
- **No connection:** when YouTube Music cannot be loaded, the app shows a page
  of its own instead of the browser's error page. It has a button to try again
  and goes back by itself as soon as the site can be reached, within five
  seconds. The page cannot reach the app's backend. Windows only for now.
- **When YouTube Music changes:** the app looks for the parts of the page it
  relies on once a song is there. What it cannot find is named at the top of
  the settings window, instead of features silently not working. Errors of a
  plugin are shown under that plugin.
- **Language:** the settings window, the tray menu and what the app and its
  plugins add to the page (buttons, panels, notices) are in English or German.
  The language follows Windows unless one is chosen in the settings window; a
  change applies at once. YouTube Music itself keeps the language of your
  Google account. Texts of external plugins stay as their authors wrote them.
- **Window:** size and position of the windows are remembered.
- **Start in the tray:** with this on, a launch by Windows at sign-in opens no
  window. Starting the app yourself always shows it.
- **Resume:** when the app starts, the track from last time is loaded again,
  paused where it stopped. YouTube Music brings the track back by itself; the
  app adds the position. The position is saved every five seconds while a
  track plays.
- **Tray icon:** its tooltip and the first line of its menu name the song. Left click shows the window; the menu offers Show, Settings,
  Play / Pause, Next, Previous, Volume up, Volume down, Mute / Unmute and
  Quit. The volume entries move YouTube Music's own slider by 10. With `minimizeToTray`, Quit in the
  tray menu is the way to exit. While in the tray the page stops rendering
  and gives back memory, see [Measurements](#measurements).
- **Global shortcuts:** key combinations for play / pause, next, previous,
  volume up, volume down and mute that work while another program has the focus and while the app is in the
  tray. None are set by default, because a global shortcut takes its keys away
  from every other program. Set them in the settings window: click a field
  and press the combination.
- **Backup:** the settings window exports all settings to a file and imports
  them again. An import replaces the current settings; a file that is not
  valid is refused and changes nothing.
- **Log:** errors of the app, of the injected script and of plugins are
  written to `%APPDATA%\io.github.ariazonaa.ytmusic-desktop\log.txt`, which the settings
  window opens. The file starts over at 512 kB; the previous one is kept as
  `log.old.txt`.
- **Single instance:** launching the app again brings the running window back.
- **Media keys:** handled by WebView2 itself, no code involved.

## Settings

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
| `shortcuts` | global shortcuts, written like `Ctrl+Alt+ArrowUp`; empty is off |
| `pluginSettings` | per-plugin settings the user changed, by plugin name |

The file is read at start; use the settings window to change settings while
the app runs. An invalid file is moved to `settings.json.bak` and replaced by the
defaults.

## Plugins

Plugins are compiled into the app and run inside the YouTube Music page. Each
one lives in `src/plugins/<name>/` and is registered in `src/plugins/index.ts`.
They are switched on in the settings window, which lists them by kind
(sound, appearance, playback, tools) with a line on what each does, and has a
search field. A plugin's settings can be put back to their defaults there.

| Plugin | What it does |
| --- | --- |
| `sponsorblock` | Skips sponsors, non-music sections and similar segments, using the [SponsorBlock](https://sponsor.ajay.app) database. Categories can be chosen individually. The notice says how long the section was and how much time was skipped so far, and its button plays the section after all. |
| `lyrics` | Adds a Lyrics button and a side panel with time-synced lyrics from [LRCLIB](https://lrclib.net). Clicking a line jumps to it. If LRCLIB has nothing, plain lyrics come from [lyrics.ovh](https://lyrics.ovh). The panel has a large view that fills the window, with its own font size, and plus and minus buttons that shift lyrics running ahead of or behind the sound; the shift is remembered per track. A key combination of your choice opens and closes the panel. |
| `equalizer` | Ten bands from 32 Hz to 16 kHz with presets (bass boost, vocal, rock and others), a custom setting and a pre-amplifier. An Equalizer button opens a panel with a slider per band and a graph of the resulting frequency response; changes are heard while dragging. Your own settings can be saved as named presets, and as files to pass on, see [Files to share](#files-to-share). Corrections for a headphone model can be imported from [AutoEq](https://github.com/jaakkopasanen/AutoEq), and the preset can be remembered per output device, see [Headphone corrections](#headphone-corrections). |
| `audio-tools` | Volume boost up to 300 %, left/right balance and mono. |
| `headphones` | Crossfeed: mixes a little of each channel into the other, slightly delayed and without its treble, as happens with speakers. Takes the hard left and right out of old recordings. Also sets the stereo width, from mono to twice as wide. |
| `normalize` | Brings every track to the same loudness, using the loudness YouTube Music measured for it. YouTube Music itself only turns down tracks above its own, very loud target; this also evens out the ones below. Three targets (quiet, medium, loud) and a limit on how much a quiet track is boosted, because more can distort its peaks. |
| `audio-only` | When a music video comes up, switches to its audio version, as the Song button above the player does. Saves the bandwidth and processor time of the picture. Clicking Video still shows the video of that track. |
| `crossfade` | The end of a track plays over the start of the next, for 1 to 10 seconds. See [How the crossfade works](#how-the-crossfade-works) for what it costs. It cannot run together with `track-fade` or `playback-speed`; switching one on switches the other off. |
| `track-fade` | The simple alternative: fades each track out at its end and the next one in, one after the other. |
| `compressor` | Evens out loud and quiet passages, in three strengths. Makes the overall sound somewhat louder. |
| `playback-speed` | Plays everything at 0.5 to 2 times the speed, with or without keeping the pitch. |
| `prefer-opus` | Makes the player choose Opus audio instead of AAC, by reporting AAC as unsupported. Applies to tracks loaded afterwards. |
| `wheel-volume` | Turning the mouse wheel over the player bar changes the volume, in steps of 1 to 10, and shows the new value. |
| `themes` | Color schemes (black, slate, midnight blue, forest, plum), an accent color for the progress bar and sliders, frosted-glass bars, the playing song's cover as a blurred background, a narrower or window-filling content column, and a field for your own CSS. A look can be saved as a file and shared, see [Files to share](#files-to-share). Scheme and accent can also be taken from the cover of the playing song, and the panel lists four ready-made themes. |
| `limiter` | Holds peaks just below full scale, so that what the equalizer, `normalize` or `audio-tools` boost does not clip. Quieter sound passes unchanged. |
| `skip-disliked` | Goes on to the next track when one comes up that you gave a thumbs down. Stops after ten in a row. |
| `visualizer` | The spectrum of what is playing, as bars behind the player bar, in the accent color. Not drawn while the app is in the tray. |
| `track-info` | An Info button and a panel with codec, bitrate, sample rate, loudness and connection speed of the playing track. |
| `demo` | A working template for new plugins. |

What the plugins send where is listed under [Privacy](#privacy).

### Files to share

Themes and equalizer presets can be saved as files and passed on. Each is one
JSON file with a name and some settings, in a folder of its kind under
`%APPDATA%\io.github.ariazonaa.ytmusic-desktop`: `themes` or `equalizer`. To share
one, pass the file on; to use someone else's, put it into the folder and press
Refresh in the plugin's panel.

The Themes button in the navigation bar opens a panel that saves the current
settings of the `themes` plugin under a name and applies saved ones.

```json
{
  "name": "Midnight glass",
  "settings": { "scheme": "midnight", "accent": "green", "blur": 14, "coverBackground": true }
}
```

`settings` takes the keys of the plugin's settings. Unknown keys are ignored
and invalid values fall back to the default. A theme cannot run code, but its
`customCss` can restyle or hide anything on the page, so the panel marks
themes that bring their own CSS. Saving under an existing name replaces that
theme.

The equalizer's panel has "Save as file" next to Save, and lists the files in
its folder. Import takes a file's preset into your saved presets and switches
to it. A preset file holds the gain of each band and of the pre-amplifier:

```json
{
  "name": "Bass",
  "settings": { "band32": 9, "band64": 5, "band125": 0, "band16000": -4, "preamp": -2 }
}
```

Bands a file leaves out count as 0 dB, and values are kept within the
sliders' range of ±12 dB.

### Headphone corrections

[AutoEq](https://github.com/jaakkopasanen/AutoEq) publishes equalizer settings
that correct the sound of several thousand headphone models. "Import AutoEq
file" in the equalizer's panel reads the text files it offers for a model:

- `… FixedBandEQ.txt` fits best: it has the equalizer's ten bands.
- `… ParametricEQ.txt` and `… GraphicEQ.txt` are converted to the ten
  bands, which is an approximation.

The import saves the curve as a preset named after the file, switches to it
and sets the pre-amplifier the file asks for. Gains are rounded to whole dB
and kept within ±12 dB.

With "Remember the preset per output device" on in the plugin's settings, the
equalizer notes which preset you choose while sound goes to a device, and
brings it back when sound goes there again: one preset for the headphones,
another for the speakers. The panel shows the device's name. The app reads
that name from Windows; on other systems the switch has no effect.

### How the crossfade works

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

### Writing a plugin

The full guide for plugin authors is [docs/plugins.md](docs/plugins.md): a
first plugin step by step, the complete API, the manifest and settings
reference, and what to know about YouTube Music. What follows here is a
summary.

`plugin.json`:

```json
{
  "name": "demo",
  "version": "0.1.0",
  "permissions": ["music.read", "ui.inject"]
}
```

A plugin with the `network` permission also lists the hosts it contacts, e.g.
`"hosts": ["lrclib.net"]`.

`index.ts` default-exports a `Plugin` (`src/shared/types.ts`):

| Hook | Called |
| --- | --- |
| `onLoad(api)` | once when the plugin is enabled, before the page has rendered |
| `onUIReady()` | once the navigation bar exists |
| `onSongChange(song)` | once per song change; needs `music.read` |
| `onPlaybackChange(state)` | when playback starts, pauses, seeks or learns the duration; needs `music.read` |
| `onSettingsChange(values)` | when the user changes one of the plugin's settings |
| `onUnload()` | when the plugin is disabled |

A hook that throws gets its plugin unloaded; the others keep running.

The `api` object exposes one namespace per permission. Reading a namespace the
manifest does not list throws a `PermissionError`.

| Permission | Namespace | Functions |
| --- | --- | --- |
| `music.read` | `api.music` | `getCurrentSong()`, `getPlaybackState()`, `getVideoId()`, `getLoudnessLkfs()`, `getLikeStatus()`, `getQueue()` |
| `music.control` | `api.player` | `seekTo(seconds)`, `setPlaybackRate(rate, preservePitch)`, `getVolume()`, `setVolume(percent)`, `next()`, `setLikeStatus(status)`, `addToQueue(videoId, position?)`, `removeFromQueue(index)`, `moveInQueue(from, to)` |
| `audio` | `api.audio` | `addEffect(order, build)` inserts Web Audio nodes between the player and the speakers; `setOutputDelay(seconds)` tells the app how far an effect holds the sound back; built-in plugins only |
| `network` | `api.net` | `getJson(url)` and `request(url, { method, headers, body })`: HTTPS only, only the manifest's `hosts`, no cookies |
| `notify` | `api.notify` | `show(title, body?, { imageUrl, onClick })`: a notification of the operating system, with a cover and a reaction to being clicked; at most one every three seconds |
| `ui.inject` | `api.ui` | `injectCss(css)` and `addNavButton(label, onClick)` return a remove function; `addPanel(title)` returns a side panel; `showNotice(text, action?)`, where `action` adds a button; `addShortcut(shortcut, onPress)` for the app's window; `navigate(target)`; `waitForElement(selector)` |

`api.settings` needs no permission: `get(key)` and `getAll()` return the
plugin's own settings, and `update(values)` changes and saves them. Values
that do not fit the plugin's schema are rejected.

### Plugin settings

A plugin declares its settings in `plugin.json`. The settings window renders a
control for each one, and changes reach the running plugin through
`onSettingsChange`.

```json
{
  "settings": {
    "accentColor": {
      "type": "select",
      "label": "Accent color",
      "default": "red",
      "options": [
        { "value": "red", "label": "Red" },
        { "value": "blue", "label": "Blue" }
      ]
    },
    "logSongs": {
      "type": "boolean",
      "label": "Log songs",
      "description": "Write every song change to the console.",
      "default": true
    }
  }
}
```

| Type | Control | Extra fields |
| --- | --- | --- |
| `boolean` | switch | |
| `string` | text field | |
| `text` | multi-line text field, e.g. for CSS | |
| `number` | number field | `min`, `max` (optional) |
| `range` | slider | `min`, `max`; optional `step` and `unit` (shown after the value) |
| `select` | dropdown | `options`: list of `{ value, label }` |

Every field needs a `label` and a `default`; `description` is optional.
`"hidden": true` keeps a field out of the settings window, for values a plugin
edits through an interface of its own. A
plugin always gets one value of the right type per field: a stored value that
does not fit the schema is replaced by the default.

The page enforces Trusted Types: build DOM with `createElement` and
`textContent`, never `innerHTML`.

For built-in plugins, permissions gate the API object but are not a sandbox:
their code runs with the page's full privileges. That is acceptable because
they ship with the app. Plugins from elsewhere are external plugins.

### External plugins

An external plugin is a folder in the app's plugins folder
(`%APPDATA%\io.github.ariazonaa.ytmusic-desktop\plugins`, or "Open plugins folder" in the
settings window):

```
plugins/
  hello/
    plugin.json    same format as above; "name" must equal the folder name
    index.js       an ES module; may import other .js files from its folder
```

A manifest can name plugins it cannot run together with, e.g.
`"conflicts": ["track-fade"]`. That holds in both directions.

`examples/plugins/hello` is a working example. After adding or editing a
plugin, click "Reload plugins" in the settings window, then switch it on. No
restart is needed.

A plugin someone sent you as a zip file needs no unpacking: "Install from a
zip file" in the settings window puts it into the plugins folder, replacing a
plugin of the same name. The archive holds the plugin's files, or one folder
with them. Only the kinds of file a plugin can use are taken out of it, at
most 500 files and 20 MB. "Remove" next to an external plugin deletes its
folder, after asking once more. Its settings stay, in case it is installed
again.

External plugins are isolated. The code runs in a hidden iframe that

- has its own, opaque origin: no access to the YouTube Music page, its
  cookies or any storage,
- is served with a policy that blocks every network request, and
- cannot call the Tauri backend.

All it can do is send messages to the app, which answers them through the
same permission-gated API built-in plugins use. So a plugin can do exactly
what its `plugin.json` asks for, and the settings window shows that list
before you switch it on.

Inside `index.js` the API is the global `ytmd`. It mirrors the built-in API,
except that every call returns a promise and hooks are subscribed with `on`:

```js
ytmd.on("songChange", async (song) => {
  await ytmd.ui.showNotice(`Now playing: ${song.title}`);
});

const remove = await ytmd.ui.addNavButton("Hello", () => { /* clicked */ });
```

| Member | Permission |
| --- | --- |
| `on(event, handler)` with `songChange`, `playbackChange`, `settingsChange`, `uiReady` | `music.read` for the first two |
| `music.getCurrentSong()`, `music.getPlaybackState()`, `music.getVideoId()`, `music.getLoudnessLkfs()`, `music.getLikeStatus()`, `music.getQueue()` | `music.read` |
| `player.seekTo(seconds)`, `player.setPlaybackRate(rate, preservePitch?)`, `player.getVolume()`, `player.setVolume(percent)`, `player.next()`, `player.setLikeStatus(status)`, `player.addToQueue(videoId, position?)`, `player.removeFromQueue(index)`, `player.moveInQueue(from, to)` | `music.control` |
| `net.getJson(url)`, `net.request(url, options)` | `network`, and the host listed in `hosts` |
| `notify.show(title, body?, options?)` | `notify` |
| `ui.injectCss(css)`, `ui.showNotice(text)`, `ui.addNavButton(label, onClick)`, `ui.addShortcut(shortcut, onPress)`, `ui.navigate(target)` | `ui.inject` |
| `ui.showPanel(title?)`, `ui.hidePanel()`, event `panelClose` | `ui.inject` |
| `settings.get(key)`, `settings.getAll()`, `settings.update(values)` | none |

An external plugin cannot touch the page's DOM. It changes the page only
through `ytmd.ui`.

All side panels, built-in and external, share one place at the right edge of
the window. Only one is open at a time: showing a panel closes the one that is
open, and its plugin is told (`onClose` for built-in plugins, the `panelClose`
event for external ones).

For an interface of its own, an external plugin uses its panel. `ui.showPanel` shows the
plugin's iframe at the right edge of the window, under a title bar with a
close button. The plugin fills it by writing to its own `document.body` with
ordinary DOM calls; `<style>` elements and inline styles work. The panel is
the same sandboxed document the plugin runs in, so it cannot contact the
network either. The exception is images: besides `data:` and `blob:` URLs,
a plugin with `music.read` may show covers from YouTube Music's image
servers, and one with `network` images from its listed hosts.

Note that `ui.inject` lets a plugin restyle the whole page,
and `network` lets it send what it can read to its listed hosts, so only
switch on plugins whose permissions make sense for what they do.

## Privacy

What leaves your computer because of this app, as opposed to because of
YouTube Music itself.

**The app.** It sends nothing of its own: no statistics, no crash reports, no
check for updates. It has no server. The window is a browser showing
`music.youtube.com`, so Google sees what it would see in any browser, with
your Google account if you sign in. The browser engine is Microsoft's WebView2,
which is part of Windows.

**Built-in plugins.** Only two contact anyone besides Google, and only while
they are switched on:

| Plugin | Contacts | Sends | When |
| --- | --- | --- | --- |
| `sponsorblock` | `sponsor.ajay.app` | the first four characters of a hash of the video id, not the id itself | once for every track |
| `lyrics` | `lrclib.net` | title and artist of the playing song | once for every track |
| `lyrics` | `api.lyrics.ovh` | title and first artist | only if LRCLIB has no lyrics |

These requests carry no cookies and no referrer. The servers see your IP
address, as every server does. `themes` loads the cover of the playing song a
second time from Google's image servers when it is set to take its colors from
the cover. All other built-in plugins work on your computer only.

The page can ask the app for the name of the device sound goes to, such as
"Headphones (WH-1000XM4)"; the equalizer uses it to remember a preset per
device. Like everything the app offers to its plugins, this is within reach of
YouTube Music's own scripts too. Nothing in the app sends it anywhere.

**External plugins.** A plugin from the plugins folder can only reach the
hosts its manifest lists, which the settings window shows, and only to fetch
JSON and images. To those it can send whatever its permissions let it read,
with `music.read` what you listen to. It cannot read cookies, your Google
account or anything else on the page.

**What is kept on your computer**, under
`%APPDATA%\io.github.ariazonaa.ytmusic-desktop` unless noted:

- `settings.json`: the settings, including those of the plugins, such as
  saved equalizer presets, the names of your output devices if the equalizer
  remembers a preset for each, lyrics timing corrections by video id and the
  time SponsorBlock skipped.
- `log.txt`: errors. A line can name a plugin or a web address that failed.
- `themes` and `equalizer`: the files you saved to share.
- The browser profile, in `%LOCALAPPDATA%\io.github.ariazonaa.ytmusic-desktop`: what a
  browser keeps for a site, including your sign-in to Google, and the track
  and position to resume from.

Uninstalling the app leaves these folders; delete them to remove everything.

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

### Playback

Checked with a Premium account on Windows 11:

- No ads are requested.
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

## License and trademarks

The code of this project is under the [MIT license](LICENSE): use it, change it
and pass it on, as long as the license text stays with it. Plugins from
others have their own licenses.

This is an independent project. It is not made, endorsed or supported by
Google. YouTube and YouTube Music are trademarks of Google LLC; the app shows
Google's own website and contains none of its code or content. Using it is
subject to YouTube's terms of service, as using the site in a browser is.
SponsorBlock, LRCLIB and lyrics.ovh are services of their own, used through
their public interfaces; their data is under their terms.

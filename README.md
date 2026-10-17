<h1 align="center">YouTube Music Desktop</h1>

<p align="center">
  YouTube Music as a desktop app: the original site, plus an equalizer, lyrics,<br>
  themes, a tray icon, global shortcuts and plugins you can write yourself.
</p>

<p align="center">
  <a href="https://github.com/Ariazonaa/ytmusic-desktop/actions/workflows/ci.yml"><img src="https://github.com/Ariazonaa/ytmusic-desktop/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-informational.svg" alt="Windows and Linux">
</p>

<p align="center">
  <img src="docs/images/lyrics.png" alt="The app playing a song, with synced lyrics in a side panel and the spectrum behind the player bar" width="860">
</p>

## Small, because it is not Electron

The app uses WebView2, the browser engine Windows already has, instead of
bringing its own copy of Chromium. Compared with
[Pear](https://github.com/pear-devs/pear-desktop), the best-known desktop app
for YouTube Music:

| | ytmusic-desktop 0.6.4 | Pear 3.12.0 |
| --- | --- | --- |
| Download | **3.8 MB** installer, 5.2 MB zip | 108 MB (the web installer fetches it), 274 MB full installer |
| On disk | **16 MB** | 396 MB |
| Memory, idle | **367 MB** private, 616 MB working set | 551 MB private, 845 MB working set |
| Memory, playing | **497 MB** private, 780 MB working set | 604 MB private, 877 MB working set |
| Window closed while playing | keeps playing in the tray, working set down to about 200 MB | quits (no tray unless switched on) |

Both measured in the same Windows Sandbox (8 GB), signed out, with default
settings, while the same music video played muted; memory counts every
process of the app, WebView2's and Electron's included, averaged over 30
seconds. The tray value is from an ordinary Windows 11 PC. How it was
measured: [docs/development.md](docs/development.md#compared-with-pear).

## What it is

A small window around `music.youtube.com`. You get YouTube Music exactly as
Google makes it, with your account, your library and your playlists, and the
app adds what a website cannot do:

- **Better sound:** a ten-band equalizer with headphone corrections, loudness
  normalization, crossfade, crossfeed for headphones, a compressor and a
  limiter.
- **More to see:** time-synced lyrics, color themes, the cover as background,
  a spectrum behind the player bar.
- **Plugins:** switch on what you want, such as skipping tracks you disliked
  or keeping the music going when YouTube Music asks whether you are still
  there, and leave the rest off. Each one is listed with what it does and may
  do; you can [write your own](docs/plugins.md).
- **A real desktop app:** tray icon, global shortcuts, media keys, start with
  Windows, and it picks up the track where you stopped.
- **Light:** the installer is under 4 MB. The app is built with
  [Tauri](https://tauri.app) and uses the browser engine Windows already has,
  instead of bringing its own.
- **Private:** no statistics, no account, no server of its own; the one thing
  it asks for is whether there is a newer version, and that can be switched off.
  [What leaves your computer](#privacy) is written down.

Everything is a plugin and off until you switch it on. The app is in English
and German.

## Pictures

| | |
| --- | --- |
| ![The equalizer panel with ten sliders and the frequency response](docs/images/equalizer.png) | ![The themes panel with ready-made themes](docs/images/themes.png) |
| **Equalizer** with presets, your own curves and [headphone corrections](#headphone-corrections). Here the colors follow the cover. | **Themes:** color schemes, accent colors, frosted glass. A look can be saved and [shared](#sharing-themes-and-presets). |
| ![The track info panel with codec, bitrate and loudness](docs/images/track-info.png) | ![The settings window with the list of plugins](docs/images/settings-plugins.png) |
| **Track info:** codec, bitrate, loudness and connection speed of what is playing. | **Settings window:** every plugin with a switch; its settings and permissions unfold on a click. |

## Install

### Windows 10 or 11

**[Download the installer](https://github.com/Ariazonaa/ytmusic-desktop/releases/latest)**
(`ytmusic-desktop_…_x64-setup.exe`) and run it. It installs for your user only
and needs no administrator rights.

The installer is not signed with a certificate, so Windows SmartScreen may
warn about an unknown publisher; "More info" and "Run anyway" get past that.

**Without installing:** the same release has
`ytmusic-desktop_…_x64-portable.zip`. Unpack it anywhere and start
`ytmusic-desktop.exe`. Settings and your sign-in are kept in your user
profile all the same.

`SHA256SUMS.txt` next to them holds the checksums of both, to check a
download with `certutil -hashfile <file> SHA256`.

**Updates:** the app looks for a newer version when it starts and tells you.
You install it with one click in the settings window, under Updates; nothing
is installed by itself. The check can be switched off there. A copy from the
zip opens the download page instead.

To build it yourself instead, see
[docs/development.md](docs/development.md#setup).

### Linux (new)

From the [latest release](https://github.com/Ariazonaa/ytmusic-desktop/releases/latest):

- **Debian, Ubuntu, Mint and others with `apt`:** download
  `ytmusic-desktop_…_amd64.deb` and install it with
  `sudo apt install ./ytmusic-desktop_*_amd64.deb`. It pulls in WebKitGTK and
  the GStreamer plugins the music needs.
- **Arch Linux, Manjaro, EndeavourOS:** the release has a `PKGBUILD` for the
  package `ytmusic-desktop-bin`. Put it in an empty folder and run
  `makepkg -si`.
- **Any other distribution:** `ytmusic-desktop_…_amd64.AppImage`. Make it
  executable (`chmod +x`) and start it. It brings the GStreamer plugins
  along and updates itself like the Windows version; the packages above are
  updated with the next release's package.

On Linux the app runs in WebKitGTK instead of WebView2. It starts on Ubuntu
and Arch, and YouTube Music plays signed out; signing in with Google and
Premium have not been tried there yet. Tracks that need DRM would not play,
and the memory saving in the tray is Windows only.
[docs/platforms.md](docs/platforms.md) has the details. Please report what
works and what does not.

macOS is not supported yet.

## First steps

1. Start the app and sign in to Google, as you would in a browser.
2. The settings window opens by itself the first time. Later, the gear button
   next to the search field opens it, and so does the tray menu.
3. Switch on the plugins you want. They start at once, without a restart.
4. Plugins with an interface of their own put a button next to the gear:
   Lyrics, Equalizer, Themes, Info.

## Plugins

### Sound

| Plugin | What it does |
| --- | --- |
| `equalizer` | Ten bands from 32 Hz to 16 kHz with presets (bass boost, vocal, rock and others) and a pre-amplifier. The panel has a slider per band and a graph of the result; you hear changes while dragging. Your own curves can be saved as presets and [shared](#sharing-themes-and-presets). Imports [headphone corrections](#headphone-corrections) and can remember a preset per output device. |
| `normalize` | Brings every track to the same loudness, using the loudness YouTube Music measured for it. YouTube Music itself only turns down the very loud ones; this also raises the quiet ones. Three targets, and a limit on how far a quiet track is boosted. |
| `crossfade` | The end of a track plays over the start of the next, for 1 to 10 seconds. Not together with `track-fade` or `playback-speed`. [How it works and what it costs](docs/development.md#how-the-crossfade-works). |
| `track-fade` | The simple alternative: each track fades out at its end and the next one fades in. |
| `headphones` | Crossfeed: mixes a little of each channel into the other, slightly delayed and without its treble, as happens with speakers. Takes the hard left and right out of old recordings. Also sets the stereo width, from mono to twice as wide. |
| `compressor` | Evens out loud and quiet passages, in three strengths. |
| `limiter` | Holds peaks just below full scale, so that what the equalizer, `normalize` or `audio-tools` boost does not clip. |
| `audio-tools` | Volume boost up to 300 %, left/right balance and mono. |

### Appearance

| Plugin | What it does |
| --- | --- |
| `themes` | Color schemes (black, slate, midnight blue, forest, plum), an accent color, frosted-glass bars, the cover of the playing song as a blurred background, a narrower or window-filling content column, and a field for your own CSS. Colors can follow the cover. Four ready-made themes are included. |
| `cover` | The cover of the playing track large, in a panel or over the whole window, and saved as a picture. |
| `visualizer` | The spectrum of what is playing, as bars behind the player bar, in the accent color. |

### Playback

| Plugin | What it does |
| --- | --- |
| `adblock` | Removes the ads YouTube Music plays between tracks for accounts without Premium. It takes them out of what the server tells the player, so they are not loaded at all; should one start anyway, it is skipped. With Premium there are no ads and the plugin has nothing to do. See the [note on ads](#license-and-trademarks). |
| `sponsorblock` | Skips sponsors, non-music sections and similar parts of music videos, using the [SponsorBlock](https://sponsor.ajay.app) database. Categories can be chosen one by one. A notice says what was skipped, and its button plays the part after all. |
| `skip-disliked` | Goes on to the next track when one comes up that you gave a thumbs down. |
| `audio-only` | Music videos without the video. With Premium it switches to the audio version, as the Song button above the player does. Without Premium that button is switched off, so the plugin loads the picture in its smallest size and shows the cover instead. Saves bandwidth and processor time. |
| `keep-playing` | After about an hour without mouse or keyboard, YouTube Music stops at the next track and asks whether to go on. This plugin keeps that question away, and presses Yes should it come up anyway. |
| `playback-speed` | Plays at 0.5 to 3 times the speed, with or without keeping the pitch; podcast episodes at a speed of their own. A speed chosen in YouTube Music's menu is kept for that kind of track. |
| `skip-silence` | Runs fast through silence at the start of a track (nobody hears silence at triple speed), and goes on to the next track when the last seconds are silent. Not together with `crossfade` or `playback-speed`. |
| `prefer-opus` | Makes the player choose Opus audio instead of AAC. |
| `wheel-volume` | Turning the mouse wheel over the player bar changes the volume. |

### Tools

| Plugin | What it does |
| --- | --- |
| `lyrics` | A side panel with time-synced lyrics from [LRCLIB](https://lrclib.net); clicking a line jumps to it. Plain lyrics from [lyrics.ovh](https://lyrics.ovh) if LRCLIB has none. A large view fills the window, a small window can show the line being sung over other programs, lines can come with a translation, and plus and minus shift lyrics that run ahead of or behind the sound, remembered per track. |
| `track-info` | A panel with codec, bitrate, sample rate, loudness and connection speed of the playing track. |
| `now-playing` | For streaming with OBS and the like: the playing track as text files and a cover in a folder (`now-playing` in the app's settings folder), and if you like as a page on `http://127.0.0.1` for a browser source. The text is yours to word, e.g. `{artist} – {title}`. |
| `stats` | Your most heard tracks and artists and your listening time per day, in a panel. Counted and kept on this computer only; a track counts once heard for 30 seconds. |
| `playlist-tools` | Saves the open playlist as a text file or as a CSV for a spreadsheet, and lists the tracks that are in it more than once, also as another version of the same song. |
| `discord` | Shows in your Discord profile what you are listening to: title, artist, cover, how far the track is, and a button for others to listen too. What shows, and whether it stays while paused, is up to you; a preview in the settings window shows how it looks. Needs the Discord app running on the same computer. |
| `demo` | A working template for people who write plugins. |

### Plugins from others

Anyone can write a plugin: a folder with a `plugin.json` and an `index.js`.

- **Install:** "Install from a zip file" in the settings window. Or put the
  plugin's folder into the plugins folder ("Open plugins folder") and click
  "Reload plugins".
- **Remove:** "Remove" next to the plugin deletes its folder, after asking
  once more.
- **What it may do:** a plugin from elsewhere runs locked away from the page.
  It cannot see your cookies or your Google account, and it reaches the
  network only at the addresses it names. The settings window shows what a
  plugin asks for before you switch it on. `ui.inject` lets a plugin restyle
  the whole page, and `network` lets it send what it can read to the hosts it
  lists, so only switch on plugins whose permissions make sense for what they
  do.

**Find plugins** in the settings window: "Load the list" under "Find
plugins" shows the plugins in this repository's
[plugin list](plugins/index.json), with what each one may do, and installs
one with a click. A download is installed only if it matches the checksum
and the permissions in the list. Nobody checks the plugins' code; read the
permissions before you switch one on. More are shown in the
["Show and tell" category of the Discussions](https://github.com/Ariazonaa/ytmusic-desktop/discussions/categories/show-and-tell).

**Write one:** [docs/plugins.md](docs/plugins.md) is the guide,
[`examples/plugins/template`](examples/plugins/template) a starting point to
copy and [`examples/plugins/hello`](examples/plugins/hello) a longer example.
The guide also says [how to share it](docs/plugins.md#sharing-a-plugin)
and [how to add it to the list](docs/plugins.md#the-plugin-list).

## The desktop side

- **Tray icon:** shows the playing song. Its menu has Play / Pause, Next,
  Previous, the volume and Quit. Closing the window can keep the music playing
  in the tray, where the app also gives back most of its memory.
- **Global shortcuts:** key combinations for play / pause, next, previous,
  volume and mute that work while another program has the focus. None are set
  at first; click a field in the settings window and press the combination.
- **Shortcuts in the window:** "Like" and "Dislike" for the playing track,
  and opening the panels of lyrics, equalizer and themes, all set in the
  same tab. They work while the app's window has the focus.
- **Media keys** work as in a browser.
- **Start with Windows**, if you like without opening a window.
- **Resume:** the track from last time is loaded again, paused where it
  stopped.
- **No connection:** instead of the browser's error page the app shows its
  own, and goes back to the music by itself once the connection is there.
- **When YouTube Music changes** and something stops working, the settings
  window says what, instead of features silently doing nothing.
- **Updates:** found at start, installed when you say so.
- **Backup:** all settings can be exported to a file and imported again.
- **Language:** English or German for everything the app adds. It follows
  Windows unless you choose one. YouTube Music itself keeps the language of
  your Google account.

Errors are written to a log file that the settings window opens.

## Sharing themes and presets

Themes and equalizer presets can be saved as files and passed on. Each is one
small JSON file in a folder of its kind under
`%APPDATA%\io.github.ariazonaa.ytmusic-desktop`: `themes` or `equalizer`. To
share one, pass the file on; to use someone else's, put it into the folder and
press Refresh in the plugin's panel. Both panels have a button that opens
their folder.

A theme file holds settings of the `themes` plugin:

```json
{
  "name": "Midnight glass",
  "settings": { "scheme": "midnight", "accent": "green", "blur": 14, "coverBackground": true }
}
```

A theme cannot run code, but its `customCss` can restyle or hide anything on
the page, so the panel marks themes that bring their own CSS. Unknown keys are
ignored and invalid values fall back to the default.

An equalizer preset holds the gain of each band and of the pre-amplifier:

```json
{
  "name": "Bass",
  "settings": { "band32": 9, "band64": 5, "band125": 0, "band16000": -4, "preamp": -2 }
}
```

Bands a file leaves out count as 0 dB, and values are kept within the sliders'
range of ±12 dB.

### Headphone corrections

[AutoEq](https://github.com/jaakkopasanen/AutoEq) publishes equalizer settings
that correct the sound of several thousand headphone models. "Import AutoEq
file" in the equalizer's panel reads the text files it offers for a model:

- `… FixedBandEQ.txt` fits best: it has the equalizer's ten bands.
- `… ParametricEQ.txt` and `… GraphicEQ.txt` are converted to the ten bands,
  which is an approximation.

The import saves the curve as a preset named after the file, switches to it
and sets the pre-amplifier the file asks for. Gains are rounded to whole dB
and kept within ±12 dB.

With "Remember the preset per output device" on in the plugin's settings, the
equalizer notes which preset you choose while sound goes to a device, and
brings it back when sound goes there again: one preset for the headphones,
another for the speakers.

## Privacy

What leaves your computer because of this app, as opposed to because of
YouTube Music itself.

**The app.** It sends no statistics and no crash reports, and it has no
server. Its one request without being asked is the look for updates: at each start it
fetches a small file from this project's releases on `github.com`, which
names the newest version. The request carries nothing about you or the app;
GitHub sees your IP address, as every server does. "Look for updates at
start" in the settings window switches it off. An update itself is downloaded
from there too, only when you click to install it, and only installed if it
carries this project's signature. "Load the list" under "Find plugins"
fetches the plugin list from `raw.githubusercontent.com`, only when you
click it; installing a plugin from it downloads its zip from the address
listed there, often `github.com`. The window is a browser showing
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
| `lyrics` | `api.mymemory.translated.net` | the lyrics and the language to translate them into | only if "Translate into" is set, once per track |

`discord` hands title, artist, album, the cover's address and the track's
link to the Discord app on your computer, which shows them in your profile to
anyone who can see it there.

These requests carry no cookies and no referrer. The servers see your IP
address, as every server does. `themes` loads the cover of the playing song a
second time from Google's image servers when it is set to take its colors from
the cover. All other built-in plugins work on your computer only.

The page can ask the app for the name of the device sound goes to, such as
"Headphones (WH-1000XM4)"; the equalizer uses it to remember a preset per
device. Like everything the app offers to its plugins, this is within reach of
YouTube Music's own scripts too. Nothing in the app sends it anywhere.

**Plugins from others.** Such a plugin can only reach the hosts its manifest
lists, which the settings window shows, and only to fetch JSON and images. To
those it can send whatever its permissions let it read, with `music.read`
what you listen to. It cannot read cookies, your Google account or anything
else on the page.

**What is kept on your computer**, under
`%APPDATA%\io.github.ariazonaa.ytmusic-desktop` unless noted:

- `settings.json`: the settings, including those of the plugins, such as
  saved equalizer presets, the names of your output devices if the equalizer
  remembers a preset for each, lyrics timing corrections by video id and the
  time SponsorBlock skipped.
- `log.txt`: errors. A line can name a plugin or a web address that failed.
- `themes` and `equalizer`: the files you saved to share.
- `plugins`: the plugins from others you installed.
- The browser profile, in `%LOCALAPPDATA%\io.github.ariazonaa.ytmusic-desktop`:
  what a browser keeps for a site, including your sign-in to Google, and the
  track and position to resume from.

Uninstalling the app leaves these folders; delete them to remove everything.

## More to read

| | |
| --- | --- |
| [CHANGELOG.md](CHANGELOG.md) | what changed in each version |
| [docs/plugins.md](docs/plugins.md) | writing plugins: a first one step by step, the API, the manifest |
| [docs/development.md](docs/development.md) | building and testing the app, how it is put together, the settings file, memory and speed measurements |
| [docs/platforms.md](docs/platforms.md) | Linux and macOS: what works and what is open |

Found a bug or have an idea? Open an
[issue](https://github.com/Ariazonaa/ytmusic-desktop/issues). The settings
window's log usually says what went wrong.

## How it is made

Large parts of the code, the tests and the documentation were written with
an AI assistant (Claude, by Anthropic), directed and reviewed by the
maintainer. Every change goes through the tests and the checks in CI, and
features are tried in the running app before a release. If you find
something that looks wrong, an issue is welcome all the same.

## License and trademarks

The code of this project is under the [MIT license](LICENSE): use it, change it
and pass it on, as long as the license text stays with it. Plugins from
others have their own licenses.

This is an independent project. It is not made, endorsed or supported by
Google. YouTube and YouTube Music are trademarks of Google LLC; the app shows
Google's own website and contains none of its code or content. Using it is
subject to YouTube's terms of service, as using the site in a browser is.
Blocking ads is against those terms, so the `adblock` plugin is off unless
you switch it on, and that is your decision; a Premium subscription removes
the ads and pays the artists.
SponsorBlock, LRCLIB and lyrics.ovh are services of their own, used through
their public interfaces; their data is under their terms.

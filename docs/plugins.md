# Writing plugins

There are two kinds of plugin. Pick by where the plugin will come from.

| | External plugin | Built-in plugin |
| --- | --- | --- |
| Lives in | a folder in the user's plugins folder | `src/plugins/` of this repository |
| Written in | JavaScript, no build step | TypeScript, built with the app |
| Runs in | a sandboxed iframe | the YouTube Music page itself |
| Can do | exactly what its manifest asks for | anything the page can |
| Shipped | by copying a folder | with a release of the app |

Write an external plugin unless you need something only a built-in one can
do: touching YouTube Music's DOM directly, processing audio, or patching the
page.

- [External plugins](#external-plugins)
- [The manifest](#the-manifest)
- [Settings](#settings)
- [Built-in plugins](#built-in-plugins)
- [What to know about YouTube Music](#what-to-know-about-youtube-music)

## External plugins

### A first plugin

1. Open the settings window (gear button in the YouTube Music bar) and click
   "Open plugins folder". It is `%APPDATA%\io.github.ariazonaa.ytmusic-desktop\plugins`.
2. Create a folder `now-playing` with two files.

   `plugin.json`:

   ```json
   {
     "name": "now-playing",
     "version": "0.1.0",
     "permissions": ["music.read", "ui.inject"]
   }
   ```

   `index.js`:

   ```js
   ytmd.on("songChange", async (song) => {
     await ytmd.ui.showNotice(`${song.artist} – ${song.title}`);
   });
   ```

3. Click "Reload plugins" in the settings window and switch `now-playing` on.

Play a song: its name appears above the player bar. After every edit, click
"Reload plugins" again; the app does not need a restart.

`examples/plugins/hello` in this repository is a longer example with a button,
a panel and a setting.

### Rules for the folder

- The folder name is the plugin's name and must equal `name` in the manifest:
  lowercase letters, digits and `-`, at most 64 characters.
- `plugin.json` (at most 64 kB) and `index.js` are required.
- `index.js` is an ES module. It may `import` other `.js` files from its own
  folder and subfolders, each at most 2 MB. Top-level `await` works.
- Besides scripts, the folder serves stylesheets (`.css`) and images
  (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`) to your document, by
  their path relative to the folder: `<link rel="stylesheet" href="style.css">`,
  `<img src="img/logo.png">`. Other kinds of file are not served; data has to
  be embedded in the code.
- A name already used by a built-in plugin is rejected. The settings window
  lists rejected folders with the reason.

To pass a plugin on, zip its folder. "Install from a zip file" in the settings
window takes an archive with the plugin's files at the top or in one folder,
at most 500 files and 20 MB unpacked, and leaves out every file that is not
`plugin.json`, a script, a stylesheet or an image. It replaces an installed
plugin of the same name; the user's settings for it stay.

### The sandbox

Your code runs in a hidden iframe with its own, opaque origin. Inside it:

| Works | Does not work |
| --- | --- |
| the whole JavaScript language, timers, `crypto.subtle` | `fetch`, `XMLHttpRequest`, WebSocket, `import()` of remote code |
| the iframe's own `document` and DOM | the YouTube Music page: `parent.document` throws |
| `<style>` elements and inline styles | cookies, `localStorage`, IndexedDB |
| images from `data:` and `blob:` URLs, and from the network [where your permissions reach](#images) | other images, fonts or media from the network |
| | opening windows, navigating the app, the Tauri backend |

Everything else goes through the global `ytmd`. Each call is a message to the
app, which checks it against the permissions in your manifest. That makes
every call asynchronous: `ytmd` functions return promises, and a call your
manifest does not allow rejects.

State lives only in memory. To keep something across restarts, declare a
setting (it may be `hidden`) and write it with `ytmd.settings.update`.

#### Images

An `<img>` or a CSS `url()` in your document may load over HTTPS from:

| Permission | Image sources |
| --- | --- |
| `music.read` | YouTube Music's cover servers: `*.ytimg.com`, `*.googleusercontent.com`, `*.ggpht.com`. This is where a song's `artworkUrl` points. |
| `network` | the `hosts` in your manifest |

Everything else is blocked, and so is reading an image's bytes with `fetch`.
The limits follow the permissions because the address of an image can carry
data: an image may only be requested where the plugin could send data anyway.
Requests carry no cookies and no referrer.

### The `ytmd` API

| Call | Permission | Notes |
| --- | --- | --- |
| `ytmd.on(event, handler)` | see events | returns a function that unsubscribes |
| `ytmd.getLanguage()` | none | `"en"` or `"de"`: the language the app's own buttons and panels are in. The plugin is started again when the user changes it |
| `ytmd.music.getCurrentSong()` | `music.read` | `{ title, artist, album, artworkUrl }` or `null` |
| `ytmd.music.getPlaybackState()` | `music.read` | `{ paused, positionSeconds, durationSeconds }` or `null` |
| `ytmd.music.getVideoId()` | `music.read` | YouTube video id or `null` |
| `ytmd.music.getLoudnessLkfs()` | `music.read` | loudness of the track in LKFS, or `null` |
| `ytmd.music.getLikeStatus()` | `music.read` | `"like"`, `"dislike"`, `"none"`, or `null` while the page has not said yet |
| `ytmd.music.getQueue()` | `music.read` | the play queue: `{ title, artist, duration, videoId, playing }` each; played, playing and upcoming tracks in order |
| `ytmd.player.seekTo(seconds)` | `music.control` | position in the current track |
| `ytmd.player.setPlaybackRate(rate, preservePitch = true)` | `music.control` | 0.25 to 4 |
| `ytmd.player.getVolume()` | `music.control` | 0 to 100, as on the page's slider |
| `ytmd.player.setVolume(percent)` | `music.control` | resolves with the applied value |
| `ytmd.player.next()` | `music.control` | goes to the next track |
| `ytmd.player.setLikeStatus(status)` | `music.control` | rates the playing track like a click on the thumbs; `"none"` takes a rating back. This changes the user's library |
| `ytmd.player.addToQueue(videoId, position = "next")` | `music.control` | puts a track right after the playing one (`"next"`) or behind everything queued (`"end"`); rejects for a track YouTube Music does not know and before anything was played |
| `ytmd.player.removeFromQueue(index)` | `music.control` | takes an upcoming track out; `index` is its position in `getQueue()` |
| `ytmd.player.moveInQueue(from, to)` | `music.control` | moves an upcoming track among the upcoming ones; both are positions in `getQueue()` |
| `ytmd.net.getJson(url)` | `network` | `{ status, data }`; see below |
| `ytmd.net.request(url, { method, headers, body })` | `network` | `{ status, text, data }`; see below |
| `ytmd.notify.show(title, body?, { imageUrl, onClick })` | `notify` | a notification of the operating system; at most one every three seconds; see below |
| `ytmd.settings.get(key)`, `getAll()` | none | the plugin's own settings |
| `ytmd.settings.update(values)` | none | saves; rejects values that do not fit the schema |
| `ytmd.ui.injectCss(css)` | `ui.inject` | resolves with a remove function; at most 256 kB |
| `ytmd.ui.showNotice(text)` | `ui.inject` | at most 200 characters |
| `ytmd.ui.addNavButton(label, onClick)` | `ui.inject` | label at most 40 characters; resolves with a remove function |
| `ytmd.ui.showPanel(title?)`, `hidePanel()` | `ui.inject` | title at most 60 characters |
| `ytmd.ui.addShortcut(shortcut, onPress)` | `ui.inject` | a key combination for the app's window, see below; resolves with a remove function |
| `ytmd.ui.navigate(target)` | `ui.inject` | goes to a page of YouTube Music without interrupting the music, see below |

Events for `ytmd.on`:

| Event | Payload | Permission |
| --- | --- | --- |
| `songChange` | the new song | `music.read` |
| `playbackChange` | the playback state, on start, pause, seek and when the length becomes known | `music.read` |
| `settingsChange` | all settings of the plugin | none |
| `uiReady` | none; the navigation bar exists | none |
| `panelClose` | none; the user closed the panel or another panel replaced it | none |

`playbackChange` does not fire as the position advances. To follow the
position, poll `getPlaybackState()` on a timer.

A plugin may hold at most 32 injected styles and buttons at a time.

### Shortcuts and navigation

`ytmd.ui.addShortcut("Ctrl+Shift+KeyL", onPress)` calls `onPress` when that
combination is pressed while the app's window has the focus, except while the
user types in a field. A shortcut is written as its modifiers in the order
`Ctrl`, `Alt`, `Shift`, `Super`, then the key's
[code](https://developer.mozilla.org/docs/Web/API/KeyboardEvent/code):
`KeyL`, `Digit1`, `ArrowUp`, `F9`. It needs `Ctrl`, `Alt` or `Super`, or must
be a function key; anything else rejects. To let the user choose the keys,
declare a setting of type `shortcut` and register its value.

`ytmd.ui.navigate(target)` goes to a page inside YouTube Music:

| Target | Goes to |
| --- | --- |
| `{ type: "search", query: "abba" }` | the search results |
| `{ type: "track", videoId: "dQw4w9WgXcQ" }` | the track, which starts playing |
| `{ type: "page", browseId: "FEmusic_explore" }` | a page by its id: an album (`MPREb_…`), an artist (`UC…`), a playlist (`VL…`), or `FEmusic_home`, `FEmusic_explore`, `FEmusic_library_landing` |

### The queue

`ytmd.music.getQueue()` lists the queue from the first played track to the
last upcoming one; the entry with `playing: true` is where playback is.
Positions in the other calls count from 0 in that list.

```js
const queue = await ytmd.music.getQueue();
const playing = queue.findIndex((track) => track.playing);
await ytmd.player.addToQueue("dQw4w9WgXcQ");          // right after the playing track
await ytmd.player.moveInQueue(queue.length - 1, playing + 1);
await ytmd.player.removeFromQueue(playing + 2);
```

Only upcoming tracks can be removed or moved, and only to places after the
playing track; anything else rejects. Read the queue again after a change,
since positions shift. YouTube Music offers no official way to change the
queue: these calls use the page's own queue store, the way its menus do.

### Notifications

```js
const song = await ytmd.music.getCurrentSong();
await ytmd.notify.show(song.title, song.artist, {
  imageUrl: song.artworkUrl,
  onClick: () => ytmd.ui.showPanel(),
});
```

- `imageUrl` shows a picture next to the text. Only covers from YouTube
  Music's image servers are loaded, which is where a song's `artworkUrl`
  points; any other address is left out and the notification is shown without
  a picture.
- Clicking a notification brings the app's window to the front. `onClick`
  is called as well, as long as the notification is among the plugin's
  newest twenty.
- Title and body are cut to 80 and 240 characters. A second notification
  within three seconds rejects.
- Whether a notification pops up or only goes to the notification center is
  the user's choice in Windows ("do not disturb").
- Picture and click work on Windows.

### Network

`ytmd.net.getJson(url)` performs a GET request over
HTTPS to a host listed in `hosts`, without cookies or a referrer, and resolves
with the status and the parsed JSON body. HTTP error statuses do not reject;
check `status`. Other hosts, plain HTTP and network failures reject.

```json
{
  "permissions": ["music.read", "network"],
  "hosts": ["api.example.com"]
}
```

`ytmd.net.request(url, options)` does the same with a method, headers and a
body of your choice, for services that need a token or take data:

```js
const { status, data, text } = await ytmd.net.request("https://api.example.com/listens", {
  method: "POST",
  headers: { Authorization: "Token …", "Content-Type": "application/json" },
  body: JSON.stringify({ title: song.title }),
});
```

- `method` is `GET` (the default), `POST`, `PUT`, `PATCH` or `DELETE`.
- `headers` takes at most 20 entries. The browser sets some itself and does
  not let a page change them, `Cookie`, `Origin` and `Host` among them.
- `body` is text of at most 256 kB; a GET has none.
- The answer comes as `text` (at most 2 MB) and, if it is JSON, parsed as `data`.
- Redirects are not followed, since they could lead to another host.
- The request is made by a web page, so the other server has to allow it
  (CORS). A server that does not answers with a network error.

A token belongs in a setting, so that the user enters it and it is not in
your code. Settings are stored in plain text on the user's computer.

### A panel

`ytmd.ui.showPanel()` shows your iframe at the right edge of the window, under
a title bar with a close button. Whatever you put into `document.body`
appears there. The document starts with a dark background, white text and
16 px padding.

```js
const list = document.body.appendChild(document.createElement("ol"));
ytmd.on("songChange", (song) => {
  list.appendChild(document.createElement("li")).textContent = song.title;
});

let open = false;
ytmd.on("panelClose", () => (open = false));
await ytmd.ui.addNavButton("History", async () => {
  open = !open;
  await (open ? ytmd.ui.showPanel("History") : ytmd.ui.hidePanel());
});
```

All panels share one place, so only one is open at a time. Listen for
`panelClose` to keep your own state right when another panel takes over.

### Editor support

Copy `ytmd.d.ts` and `ytmd-api.d.ts` from `examples/plugins/hello` into your
plugin's folder and start `index.js` with:

```js
/// <reference path="./ytmd.d.ts" />
// @ts-check
```

Your editor then completes and checks `ytmd`. The app ignores the files.

### Finding errors

An uncaught error in your plugin shows up in three places: in red under the
plugin in the settings window (its latest five, until the plugins are
reloaded), in the log file the settings window opens, and in the main
window's console as `[ytm-desktop] plugin "<name>": <message>`. A plugin the
app refused to load is listed in the settings window with the reason.

The console is only available in a development build (`npm run dev`, then
Ctrl+Shift+I).

### Reloading while you work

"Reload when files change" in the settings window, under the plugin list,
restarts the external plugins about two seconds after any file in the plugins
folder changed, so an edit shows up when you save. Without it, "Reload
plugins" does the same on a click. A changed `plugin.json` also needs "Reload
plugins" for the settings window to show its new contents.

## The manifest

`plugin.json`, for both kinds of plugin:

```json
{
  "name": "example",
  "version": "0.1.0",
  "description": "Shows an example.",
  "category": "tools",
  "permissions": ["music.read", "ui.inject", "network"],
  "hosts": ["api.example.com"],
  "conflicts": ["other-plugin"],
  "settings": {}
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | unique id: lowercase letters, digits, `-`; at most 64 characters |
| `version` | yes | any non-empty text, shown in the settings window |
| `description` | no | one or two sentences on what the plugin does, shown in the settings window; at most 300 characters |
| `category` | no | where the settings window lists it: `audio`, `appearance`, `playback` or `tools` (the default) |
| `permissions` | yes | list of the permissions below; may be empty |
| `hosts` | with `network` | host names the plugin may contact |
| `conflicts` | no | names of plugins it cannot run together with; holds in both directions |
| `settings` | no | the plugin's settings, see [Settings](#settings) |

| Permission | Grants |
| --- | --- |
| `music.read` | the current song, playback state, video id, loudness, rating and queue, and the song and playback events |
| `music.control` | seeking, playback speed, volume, next track, rating the playing track, adding, removing and moving tracks in the queue |
| `ui.inject` | CSS in the page, notices, buttons, panels, shortcuts in the app's window, going to a page |
| `network` | requests to the listed `hosts` |
| `notify` | notifications of the operating system |
| `audio` | inserting audio effects; built-in plugins only |

The settings window shows a plugin's permissions and hosts before the user
switches it on. Ask for what the plugin uses and no more.

## Settings

Declare settings in the manifest. The settings window draws a control for
each, saves changes at once and tells the running plugin.

```json
{
  "settings": {
    "greeting": { "type": "string", "label": "Greeting", "default": "Hello" },
    "size": {
      "type": "range",
      "label": "Size",
      "description": "In pixels.",
      "default": 16,
      "min": 12,
      "max": 28,
      "step": 1,
      "unit": "px"
    },
    "mode": {
      "type": "select",
      "label": "Mode",
      "default": "a",
      "options": [
        { "value": "a", "label": "First" },
        { "value": "b", "label": "Second" }
      ]
    }
  }
}
```

| Type | Control | Value | Extra fields |
| --- | --- | --- | --- |
| `boolean` | switch | `true` or `false` | |
| `string` | text field | text | |
| `text` | multi-line text field | text | |
| `number` | number field | number | `min`, `max` (optional) |
| `range` | slider | number | `min`, `max` (required); `step`, `unit` (optional) |
| `select` | dropdown | one of the option values | `options`: list of `{ value, label }` |
| `color` | color picker | a color like `#3b82f6` | |
| `shortcut` | a field that records a key combination | a shortcut like `Ctrl+Shift+KeyL`, or empty for none | |

Every field needs `label` and `default`. `description` adds a line under the
label. `"hidden": true` keeps a field out of the settings window, for values
the plugin edits through its own interface or uses as storage.

Setting keys are letters, digits, `_` and `-`, at most 64 characters. A plugin
may have at most 64 settings, and a text value at most 16 kB.

A plugin always sees one value of the right type per field. If a stored value
does not fit the schema, for instance after you changed the schema, the
default is used instead.

## Built-in plugins

A built-in plugin is a folder in `src/plugins/` with a `plugin.json` and an
`index.ts` that default-exports a `Plugin`. Register it in
`src/plugins/index.ts`. `src/plugins/demo` is a small complete example.

```ts
import { parseManifest } from "../../core/plugin-manager/api";
import type { Plugin, PluginApi } from "../../shared/types";
import manifest from "./plugin.json";

let api: PluginApi | undefined;

const example: Plugin = {
  manifest: parseManifest(manifest),

  onLoad(pluginApi) {
    api = pluginApi;
    api.ui.addNavButton("Example", () => api?.ui.showNotice("Hello"));
  },

  onSongChange(song) {
    console.info(song.title);
  },

  onUnload() {
    api = undefined;
  },
};

export default example;
```

### Hooks

| Hook | Called | Permission |
| --- | --- | --- |
| `onLoad(api)` | once when the plugin is enabled; the page may not have rendered yet | |
| `onUIReady()` | once the navigation bar exists; at once if it already does | |
| `onSongChange(song)` | once per song | `music.read` |
| `onPlaybackChange(state)` | on start, pause, seek and when the length becomes known | `music.read` |
| `onSettingsChange(values)` | when the plugin's settings change | |
| `onUnload()` | when the plugin is disabled | |

All hooks are optional. A hook that throws gets its plugin unloaded; the other
plugins keep running. Users switch plugins on and off while the app runs, so
`onUnload` must leave nothing behind and `onLoad` must work at any time.

### The API

The `api` object has one namespace per permission; reading a namespace the
manifest does not list throws a `PermissionError`. The calls are those of
`ytmd` above, but synchronous, plus:

| Call | Permission | Notes |
| --- | --- | --- |
| `api.ui.showNotice(text, { label, onClick })` | `ui.inject` | a notice with a button |
| `api.ui.waitForElement(selector)` | `ui.inject` | resolves when the element exists |
| `api.ui.addPanel(title)` | `ui.inject` | a `Panel` with `body`, `open`, `show()`, `hide()`, `setTitle()`, `onClose()` |
| `api.audio.addEffect(order, build)` | `audio` | see [Audio effects](#audio-effects) |
| `api.audio.setOutputDelay(seconds)` | `audio` | see [Audio effects](#audio-effects) |

`src/shared/types.ts` documents every member.

Whatever a plugin adds through the API is removed when it unloads: CSS,
buttons, panels, shortcuts, audio effects. Only undo in `onUnload` what you did yourself:
timers, event listeners, elements you created.

Permissions gate the API, not the plugin. A built-in plugin runs in the page
with its full privileges and can do things no permission covers, as
`prefer-opus` does by patching a browser function. That is acceptable only
because built-in plugins are reviewed with the app.

### Touching the page

- YouTube Music enforces Trusted Types: `innerHTML` and its relatives throw.
  Build elements with `createElement` and `textContent`.
- Inject CSS with `api.ui.injectCss`, which is exempt from the page's policy.
- Keep selectors for YouTube Music's elements in `SELECTORS`
  (`src/core/injector/dom.ts`). Its DOM changes, and one place to fix is
  better than many.
- Prefer the API's building blocks (`addNavButton`, `addPanel`, `showNotice`)
  over your own. They look alike and clean up after themselves.

### Audio effects

All audio plugins share one chain between the player and the speakers:

```ts
api.audio.addEffect(20, (context) => {
  const gain = context.createGain();
  gain.gain.value = 0.5;
  return { input: gain, output: gain };
});
```

`build` runs once the audio context exists, which may be later than `onLoad`.
Effects run in ascending `order`: the crossfade is 1, the equalizer 10, the
compressor 20, audio-tools 30, headphones 35, track-fade 40.

The context runs at 192 kHz. Do not create a second `AudioContext` for the
player, and do not call `createMediaElementSource` yourself: an element can be
tapped only once, and the chain already did.

An effect that delays the sound must report by how much with
`setOutputDelay`, so that positions given to plugins describe what is heard.

`api.audio.getOutputDevice()` resolves with the name of the device sound goes
to, as the system shows it, or `null` where the app cannot tell (anywhere but
Windows). `api.audio.onOutputDeviceChange(handler)` calls back when that
changes.

### Texts

What a built-in plugin shows in the page goes through `t` from
`src/core/i18n.ts`, with the English text as the key:

```ts
import { t } from "../../core/i18n";

api.ui.showNotice(t("Volume {volume} %", { volume }));
```

The German text belongs into `src/core/i18n-de.ts`. A test fails for a text
without one, for a German text with other placeholders, and for an entry
nothing uses. It finds texts by the literal in `t("…")`; a text that reaches
`t` from a table has to be added to the test. Call `t` when the text is
shown, not at the top of the module: the language is set after the modules are
loaded. All plugins start again when the user changes the language.

### Developing

`npm run dev` starts the app and rebuilds on change. Edits to a built-in
plugin reload the page within a couple of seconds. See
[development.md](development.md) for the rest of the loop.

Put logic that does not need the page into its own file and test it with
Vitest (`npm test`). The plugins here keep the DOM and Web Audio parts thin
for that reason: `lyrics/lrc.ts`, `sponsorblock/segments.ts`,
`crossfade/plan.ts`. `npm run typecheck` must pass.

Give a built-in plugin a `description` and a `category`, and add German
texts for the description and every label to `src/ui/i18n/de.ts`; a test
fails for a text that has none.

Tests cannot tell you whether the plugin works in YouTube Music. Check it in
the running app, and include a track running into the next one by itself.

## What to know about YouTube Music

These cost time to find out. They apply to both kinds of plugin unless noted.

- **Positions are per track, and they are what is heard.** Use the position
  and length the API gives you. For built-in plugins: do not read
  `video.currentTime` or `video.duration`. When one track runs into the next,
  the element's clock keeps counting, and its duration describes the next
  track seconds before the end.
- **Seek through the API.** For the same reason, setting `video.currentTime`
  lands in the wrong place after such a transition.
- **The `<video>` element can be replaced.** Built-in plugins must not hold
  on to it across events. Look it up when needed.
- **`songChange` comes from the Media Session.** The title and artist are what
  YouTube Music announces to the system. Titles of music videos often carry
  additions like "(Official Video)".
- **Volume is not linear.** `getVolume` and `setVolume` use the page's slider,
  where 44 is about 16 % of full loudness.
- **In the tray, timers slow down.** A hidden page runs timers at most about
  once a second. Do not rely on finer timing while the window is hidden.
- **Leaving a playing page asks first.** YouTube Music shows a "leave site?"
  dialog on reload during playback. Automated tests have to answer it.

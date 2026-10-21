# Changelog

What changed for someone using the app, newest first. The version is
maintained in `package.json`; `npm version <new>` updates the Rust side and
this file needs a new heading.

## 0.10.0

- "Save memory in the tray" in the settings window: after a pause of 10, 30
  or 60 minutes in the tray, YouTube Music is unloaded, and loaded again with
  the track where it was when the window opens or Play / Pause is pressed.
- "Output" in the tray menu plays the music on another device than the
  system's default, e.g. headphones; also `--output="<device>"` and
  `--output=default`. On Linux it needs `pactl`. On Windows YouTube Music
  gets the microphone permission while a device is chosen, as the page sees
  the devices only with it; the app keeps it from opening the microphone.
- `ytmusic://` links open in the app: `ytmusic://watch?v=…` is the page
  `music.youtube.com/watch?v=…`. The installer and the Linux packages
  register the scheme; the uninstaller removes it.
- Portable mode: with an empty file `portable` or `portable.txt` next to the
  program (or next to the AppImage), settings, plugins, the log and the
  sign-in are kept in the folder `ytmusic-desktop-data` beside it. The
  settings window says so under About.
- Mini player: a small window above other programs with cover, title,
  artist, progress and the buttons, opened from the tray menu or with
  `--mini-player`. Its corner buttons bring back the main window or close it.
- Sleep timer in the tray menu: pauses after 15, 30, 45, 60 or 90 minutes, or
  at the end of the playing track, and shows the minutes left. Also
  `--sleep=30`, `--sleep=end` and `--sleep=off`. It only ever pauses.
- Taskbar on Windows: Previous, Play / Pause and Next under the window's
  thumbnail and in the taskbar button's right-click list, and the track's
  progress in the button.
- `ytmusic-desktop --play-pause`, `--next`, `--previous`, `--volume-up`,
  `--volume-down` and `--mute` control the running app, e.g. from a Stream Deck.
- "Always on top" for the window, in the tray menu.
- Zoom of the page, in the settings window under General.
- New plugin `song-notification`: a notification with the cover when a new
  track starts, while the window is not in front.
- Windows: a click on a notification brings the window back also from the
  notification centre, after its banner has gone; until now only a click on
  the banner did. The click comes as a `ytmusic://` link, which the installer
  sets up; a portable copy keeps the old way.
- "About" in the settings window, with a link to the project.
- The autostart entry on Windows has the program's path in quotes.
- Updates: "Also offer test versions" in the settings window offers betas as
  updates too; it is off. A copy that cannot replace itself (the portable zip,
  the Linux packages) now opens the release page of the version found, not
  the newest regular one.
- Linux: the .deb of a beta carries its version as `0.10.0~beta.1` and so on,
  which apt counts as before 0.10.0, so the release installs over it as an
  update, without `--allow-downgrades`.

## 0.9.0

- Linux: signing in to Google with a security key (a YubiKey and the like)
  works. WebKitGTK cannot ask a key itself, so for Google's sign-in page the
  app does, over USB; a key with a PIN asks for it in a small dialog. From a
  pull request by Herobr1ne (GitHub #2).
- Linux: signing out of YouTube Music no longer shows a dialog with the
  message "false".
- `audio-only`: where a video has no song to switch to (every music video
  without Premium, and videos without a song version also with Premium), the
  cover now shows in place of the picture instead of a grey area.
- Plugins from others are held tighter, from a review by Tumult1337 (GitHub
  pull request #1): CSS they put in the page may not load anything (`url()`,
  `@import` and the like), since that went out past the `network` permission.
  On Linux their frames can no longer go to a page outside the app, nor to a
  `data:` or `blob:` document: the navigation is stopped, nothing opens in the
  browser, and a plugin whose frame loads another page all the same is
  stopped. On Windows the app keeps the frames on their own document, watched
  before YouTube Music loads, and plugins from others do not run if it cannot.
- Playlist export: a title that starts like a formula (`=`, `+`, `-`, `@`) is
  written to the CSV as text, so a spreadsheet does not run it.
- Pictures for notifications: at most 1 MB, four at a time, ten seconds each,
  no redirects. The now-playing page answers at most eight connections at once.
- Linux: playback no longer stops after about a minute of a track. The app
  now presents itself as Safari on Linux, as GNOME Web does, instead of as
  Chrome, so that YouTube's check of the browser succeeds.
- YouTube Music shows some page loads with a new player bar. Next, previous,
  volume, mute, the time, the progress bar and the thumbs work in it as in the
  old one, and the settings window no longer says YouTube Music has changed.
- Linux: plugins from others (installed from a zip or "Find plugins") run;
  before, their button never appeared.
- `stats`: a track heard for less than 30 seconds no longer shows as "0×",
  and the listening-time chart has a place for each of the 30 days.
- `lyrics`: a line the translation service gives back unchanged gets no
  translation under it.
- Plugin API: `net.openInBrowser(url)` opens a sign-in page in the browser, on
  the plugin's own hosts only.
- `lyrics` in a window over other programs: the line being sung and the next
  one, in a small window that stays on top and can be dragged anywhere.
- `lyrics` translates: each line with its translation under it, from
  MyMemory, when "Translate into" is set.
- `normalize` and `crossfade` together: during the overlap each track plays at
  its own level, the end of a loud one no longer jumps to the level of the next.
- New plugin `skip-silence`: silence at the start of a track runs by fast,
  silence at its end goes on to the next track.
- New plugin `playlist-tools`: saves the open playlist as a text file or a
  CSV, and lists the tracks that are in it more than once.
- New plugin `stats`: your most heard tracks and artists and your listening
  time per day, counted and kept on this computer only.
- New plugin `now-playing`: the playing track for OBS and other streaming
  software, as text files and a cover in a folder, and if you like as a page
  on 127.0.0.1 for a browser source.
- Linux: the volume slider works again after an audio plugin was switched
  on (equalizer, compressor and the others), also once it is off again. On
  Linux the browser engine leaves the volume to the app as soon as the sound
  runs through the plugins.
- New plugin `cover`: the cover of the playing track large, in a panel or
  over the whole window, and saved as a picture.
- Shortcuts in the app's window, set in the Shortcuts tab: "Like" and
  "Dislike" for the playing track, and opening the panels of lyrics,
  equalizer and themes. A second press takes a rating back.
- `playback-speed`: podcasts have a speed of their own, and a speed chosen in
  YouTube Music's menu is kept for that kind of track. Up to 3 times now.
- Plugin API: `music.getTrackType()` says whether a song, a music video or a
  podcast episode plays.
- Linux: the settings window says "Start at sign-in" and "Same as the system"
  instead of naming Windows, and its lists, like the equalizer's presets, open
  dark as on Windows instead of as light GTK menus. Title bars are dark.
- "YouTube Music has changed" no longer shows up when the app looked while a
  page was still loading: what is missing counts only if it is still missing
  15 seconds later, and the message goes away by itself once it is there.
- Linux: over the .deb of 0.9.0-beta.3 this version goes with
  `sudo apt install --allow-downgrades ./ytmusic-desktop_0.9.0_amd64.deb`;
  Debian counts `-beta.3` as a later build of 0.9.0.

## 0.8.0

- New plugin `discord`: your Discord profile shows what you are listening
  to, with cover, progress and a button to listen too, as "Listening to
  YouTube Music". Works with the Discord app on Windows and Linux.
- Its settings choose what the member list shows next to your name (the
  artist, the title or YouTube Music), whether title and artist link to
  YouTube Music, the cover, the progress, a small icon that tells whether you
  like the track, the buttons, and what happens while paused. A preview in
  the settings window shows the status as Discord gets it.
- After Discord was restarted, the status comes back by itself.
- Equalizer, "preset per output device": a device also brings back your own
  curve, not only the name of the preset.
- SponsorBlock skips the chosen parts again on every run of a repeated track.
- A plugin switched on while a track plays knows the track at once, not only
  from the next one.
- Changes from the settings window and from plugins no longer overwrite each
  other when they come at the same time.
- Plugins from others are held tighter: their frame cannot reach the network
  through link hints (`preconnect`, `prerender`) or WebRTC, their keyboard
  shortcuts cannot take copying, reloading or zooming from the window,
  opening a track needs `music.control`, and an answer to `net` requests is
  read up to 2 MB and no further.
- "Find plugins" in the settings window: a list of plugins by others, kept
  in this repository, with what each may do. One click installs a plugin;
  the download must match the checksum and the permissions in the list. A
  newer version in the list is offered as an update. Authors add their
  plugins by pull request, see docs/plugins.md. The list starts with the
  example plugin `hello`.
- The page can open the settings window or a folder at most once a second.
- The app starts where WebView2 is part of Windows but not registered, as in
  Windows Sandbox, and the installer no longer gives up there.

## 0.7.0

- Linux: the app is out for Linux as a .deb (Debian, Ubuntu and others with
  apt), as a package for Arch Linux (`PKGBUILD` in the release, for the AUR
  as `ytmusic-desktop-bin`) and as an AppImage, which updates itself.
- The app opens a link given at the start, such as
  `ytmusic-desktop https://music.youtube.com/watch?v=…`; given to a running
  app, it opens there.

## 0.6.4

- The app is also available as a portable zip: unpack it and start
  `ytmusic-desktop.exe`, nothing is installed. A copy from the zip offers the
  download page when there is a new version.
- Every release has `SHA256SUMS.txt` with the checksums of the installer and
  the zip.

## 0.6.3

- New plugin `keep-playing`: the music no longer stops with "Video paused.
  Continue watching?" after an hour without mouse or keyboard.
- `audio-only` now does something without Premium, where a music video has
  no audio version to switch to: the picture is loaded in its smallest size
  and the cover is shown in its place.

## 0.6.2

Fixes from a review of the code.

Security:

- A plugin from others could send data out without the `network` permission,
  by pointing its own frame at another address. Such a navigation is now
  cancelled, and a plugin whose frame leaves its document anyway is stopped.
- `net.getJson` followed redirects, which could lead to a host the plugin's
  manifest does not list. It no longer does, like `net.request`.
- The page could save any number of theme and preset files. There is a limit
  of 100 now, and a file too large to be read back is not written.

Fixed:

- An audio effect that failed to start could leave the app without sound
  until a restart. It is now left out and the rest keeps playing.
- Crossfade: the sound comes back on whenever playback goes on after a pause,
  also when another track was chosen meanwhile. Switching the plugin off no
  longer skips the seconds the player was ahead.
- Equalizer: an imported preset whose name was cut at a space was saved but
  not applied. AutoEq files with `+3.0` or a decimal comma are read in full.
- Themes: a track without a cover no longer keeps the colors of the one before.
- Settings window: with "Switched on" chosen, a plugin stays in the list when
  it is switched off. An update found while the window is open shows up by
  itself.
- A settings file that cannot be read at start is kept as `settings.json.bak`
  instead of being written over.
- Installing a plugin over an existing one puts the old one back if the new
  one cannot take its place.
- The log file starts over at its size limit while the app runs, not only at
  start.
- Positions sent to plugins with `playbackChange` describe what is heard, as
  `getPlaybackState` already did.

## 0.6.1

- The settings window is tidier: tabs for plugins, general settings,
  shortcuts, updates and backup instead of one long page. The plugins can be
  filtered by kind or to those switched on, and a plugin's settings and
  details unfold on a click.

## 0.6.0

- New plugin `adblock`: removes the ads between tracks for accounts without
  Premium.

## 0.5.1

- Nothing new in the app. This is the first release built and published by
  the release workflow, and the first one installed apps update to by
  themselves.

## 0.5.0

- Updates: the app looks for a newer version at start and says so. It is
  installed with a click under Updates in the settings window, which also
  shows the installed version and can switch the check off.
- Installers are published as releases on GitHub.

## 0.4.2

- The settings window says what the language setting covers: the window, the
  tray menu and what the app adds to the page.
- The README is written for people who use the app and has pictures; what
  developers need moved to `docs/development.md`.

## 0.4.1

- The app has a new identifier, so its files are now in
  `%APPDATA%io.github.ariazonaa.ytmusic-desktop` and the browser profile in
  the folder of that name under `%LOCALAPPDATA%`. Settings and the sign-in of
  an earlier version are not taken over by themselves; rename the old folders
  to keep them.

## 0.4.0

- New plugin `headphones`: crossfeed and stereo width.
- Equalizer: imports headphone corrections from AutoEq files, and can
  remember the preset per output device.
- Plugins can be installed from a zip file and removed in the settings window.
- The tray menu and the app's buttons, panels and notices in the page are in
  German too, following the language setting.

For plugin authors:

- `ytmd.getLanguage()` tells the language the app's own interface is in.

## 0.3.3

- Without a connection, the app shows a page of its own with a button to try
  again, and goes back to YouTube Music by itself once there is a connection.

## 0.3.2

For plugin authors:

- `player.removeFromQueue` and `player.moveInQueue` take upcoming tracks out
  of the queue and reorder them.

## 0.3.1

For plugin authors:

- `player.addToQueue` puts a track right after the playing one or at the end
  of the queue.
- Notifications can show a cover and tell the plugin when they are clicked;
  a click also brings the app's window to the front.

Fixed:

- `music.getQueue` listed a track twice when it exists both as song and as video.

## 0.3.0

New in the app:

- On the first start no plugin is switched on, and the settings window opens
  and says where to choose some.
- The settings window lists plugins by kind, with a line on what each does,
  and has a search field. A plugin's settings can be put back to their defaults.
- When YouTube Music changes and the app cannot find a part of the page it
  needs, the settings window says which. Errors of a plugin are shown under it.
- `lyrics`: a key combination of your choice opens and closes the panel.

For plugin authors:

- More to read and do: the play queue, the rating of the playing track and
  setting it, the track's loudness, going to the next track, going to a page
  of YouTube Music, key combinations in the app's window.
- `net.request` makes requests with a method, headers and a body.
- A new permission `notify` shows notifications of the operating system.
- Two more kinds of setting: `color` and `shortcut`.
- A manifest can carry a `description` and a `category`.
- External plugins get all of the above, can load stylesheets and images from
  their own folder, and can be reloaded automatically when a file changes.

## 0.2.0

New in the app:

- The settings window is available in German and follows the language of Windows.
- Size and position of the windows are remembered.
- With "Start in the tray", a launch at sign-in opens no window.
- The track from last time is loaded again at start, paused where it stopped.
- The tray shows the song in its tooltip and as the first line of its menu.
- Settings can be exported to a file and imported again.
- Errors go to a log file, which the settings window opens.
- Muting and unmuting from the tray or with a shortcut brings back the exact volume.

New plugins:

- `normalize` brings every track to the same loudness.
- `limiter` holds peaks below full scale, so that boosts do not distort.
- `audio-only` switches music videos to their audio version.
- `skip-disliked` skips tracks you gave a thumbs down.
- `visualizer` shows the spectrum behind the player bar.
- `track-info` shows codec, bitrate, sample rate and loudness of the playing track.

Changed plugins:

- `themes`: glass effect for the bars, the cover as a blurred background, a
  narrower or window-filling content column, four ready-made themes, colors
  taken from the cover, and themes as files to share.
- `equalizer`: presets as files to share.
- `lyrics`: a large view that fills the window, and a correction for lyrics
  that run ahead of or behind the sound, remembered per track.
- `sponsorblock`: the notice says how long the skipped section was and how
  much time was skipped so far; its button plays the section after all.

For plugin authors:

- External plugins can show images in their panel: covers with `music.read`,
  images from their listed hosts with `network`.
- Built-in plugins can read the loudness and the rating of the playing track,
  go to the next track and show notices with a button.

## 0.1.0

The first version: YouTube Music in a window of its own, with a tray icon,
global shortcuts, a settings window and a plugin system. Plugins: SponsorBlock,
lyrics, equalizer, compressor, audio tools, crossfade, track fade, playback
speed, prefer Opus, wheel volume, themes. External plugins run in a sandbox.

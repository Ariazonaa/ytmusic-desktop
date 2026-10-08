# Changelog

What changed for someone using the app, newest first. The version is
maintained in `package.json`; `npm version <new>` updates the Rust side and
this file needs a new heading.

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

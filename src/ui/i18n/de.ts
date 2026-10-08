/** German texts for the settings window, by their English text. */
const de: Readonly<Record<string, string>> = {
  // Window
  Settings: "Einstellungen",
  "Could not load settings: {reason}": "Einstellungen konnten nicht geladen werden: {reason}",
  "Could not save settings: {reason}": "Einstellungen konnten nicht gespeichert werden: {reason}",
  "Could not list plugins: {reason}": "Plugins konnten nicht aufgelistet werden: {reason}",
  "Could not reload plugins: {reason}": "Plugins konnten nicht neu geladen werden: {reason}",
  "Could not open the plugins folder: {reason}": "Der Plugin-Ordner ließ sich nicht öffnen: {reason}",
  "Could not open the log: {reason}": "Das Protokoll ließ sich nicht öffnen: {reason}",
  "Could not export the settings: {reason}": "Einstellungen konnten nicht exportiert werden: {reason}",
  "Could not import the settings: {reason}": "Einstellungen konnten nicht importiert werden: {reason}",

  // General
  General: "Allgemein",
  "Start with Windows": "Mit Windows starten",
  "Launch the app when you sign in.": "Startet die App, wenn du dich anmeldest.",
  "Start in the tray": "Im Tray starten",
  "When Windows launches the app at sign-in, no window opens. Click the tray icon to show it.":
    "Startet Windows die App bei der Anmeldung, öffnet sich kein Fenster. Ein Klick auf das Tray-Symbol zeigt es.",
  "Minimize to tray": "In den Tray minimieren",
  "Closing the window keeps the music playing. Quit from the tray menu.":
    "Beim Schließen des Fensters läuft die Musik weiter. Beenden geht über das Tray-Menü.",
  "Resume the last track": "Letzten Titel wieder laden",
  "When the app starts, it loads the track from last time, paused where you stopped.":
    "Beim Start lädt die App den Titel vom letzten Mal, pausiert an der Stelle, an der du aufgehört hast.",
  "Hardware acceleration": "Hardwarebeschleunigung",
  "Off saves memory but uses more processor time, mostly for videos. Applies after a restart.":
    "Aus spart Arbeitsspeicher, braucht aber mehr Prozessorzeit, vor allem bei Videos. Gilt nach einem Neustart.",
  "Restart the app to apply this change.": "Starte die App neu, damit die Änderung gilt.",
  "Restart now": "Jetzt neu starten",
  Language: "Sprache",
  "Of this window, the tray menu and what the app adds to the page.":
    "Für dieses Fenster, das Tray-Menü und alles, was die App in die Seite einfügt.",
  "Same as Windows": "Wie Windows",

  // Global shortcuts
  "Global shortcuts": "Globale Tastenkürzel",
  "Play / Pause": "Wiedergabe / Pause",
  Next: "Weiter",
  Previous: "Zurück",
  "Volume up": "Lauter",
  "Volume down": "Leiser",
  "Mute / Unmute": "Stumm / Laut",
  "These work while another program has the focus, and take the keys away from it. Click a field and press the combination.":
    "Sie wirken auch, wenn ein anderes Programm den Fokus hat, und nehmen ihm die Tasten weg. Klicke in ein Feld und drücke die Kombination.",
  "Not set": "Nicht belegt",
  Clear: "Löschen",
  "Press the keys…": "Tasten drücken…",
  "{label} shortcut": "Tastenkürzel für {label}",

  // Welcome and problems
  "Welcome!": "Willkommen!",
  "No plugin is switched on yet. Choose the ones you like under Plugins; each takes effect at once. This window opens again with the gear button in YouTube Music or from the tray icon.":
    "Noch ist kein Plugin eingeschaltet. Wähle unter Plugins aus, was dir gefällt; jedes wirkt sofort. Dieses Fenster öffnest du wieder über das Zahnrad in YouTube Music oder über das Tray-Symbol.",
  "YouTube Music has changed": "YouTube Music hat sich geändert",
  "The app could not find {parts}. What depends on it may not work until the app is updated.":
    "Die App hat {parts} nicht gefunden. Was davon abhängt, funktioniert vielleicht nicht, bis die App aktualisiert wird.",
  "the player's function {name}": "die Player-Funktion {name}",
  "the navigation bar": "die Navigationsleiste",
  "the player bar": "die Player-Leiste",
  "the Next button": "den Weiter-Knopf",
  "the Previous button": "den Zurück-Knopf",
  "the volume slider": "den Lautstärkeregler",
  "the mute button": "den Stumm-Knopf",
  "the time display": "die Zeitanzeige",
  "the progress bar": "den Fortschrittsbalken",
  "the like buttons": "die Daumen-Knöpfe",
  "the player": "den Player",
  "Error: {message}": "Fehler: {message}",

  // Plugins
  Plugins: "Plugins",
  "Search plugins": "Plugins durchsuchen",
  "No plugin matches the search.": "Kein Plugin passt zur Suche.",
  Sound: "Ton",
  Appearance: "Aussehen",
  Playback: "Wiedergabe",
  Tools: "Werkzeuge",
  "Reset to defaults": "Auf Standard zurücksetzen",
  "Reload when files change": "Bei geänderten Dateien neu laden",
  "For plugin authors: external plugins start again as soon as a file in the plugins folder changes.":
    "Für Plugin-Autoren: Externe Plugins starten neu, sobald sich eine Datei im Plugin-Ordner ändert.",
  external: "extern",
  "Permissions: {list}": "Rechte: {list}",
  "No permissions": "Keine Rechte",
  "Contacts: {hosts}": "Verbindet sich mit: {hosts}",
  "Not together with: {names}": "Nicht zusammen mit: {names}",
  "No plugins installed.": "Keine Plugins installiert.",
  "Ignored plugin folder {reason}": "Plugin-Ordner übergangen: {reason}",
  "External plugins run in a sandbox. Reload after adding or editing one.":
    "Externe Plugins laufen in einer Sandbox. Lade sie neu, nachdem du eines hinzugefügt oder geändert hast.",
  "Open plugins folder": "Plugin-Ordner öffnen",
  "Install from a zip file": "Aus Zip-Datei installieren",
  "Installed {name}. Switch it on in the list above.": "{name} installiert. Schalte es in der Liste oben ein.",
  "Could not install the plugin: {reason}": "Das Plugin ließ sich nicht installieren: {reason}",
  Remove: "Entfernen",
  "Really remove? Its files are deleted.": "Wirklich entfernen? Seine Dateien werden gelöscht.",
  "Removed {name}.": "{name} entfernt.",
  "Could not remove the plugin: {reason}": "Das Plugin ließ sich nicht entfernen: {reason}",
  "Reload plugins": "Plugins neu laden",
  "Switched off {names}, which cannot run together with {name}.":
    "{names} ausgeschaltet, weil es nicht zusammen mit {name} laufen kann.",
  " and ": " und ",

  // Backup and log
  "Backup and log": "Sicherung und Protokoll",
  "Export writes all settings, including those of the plugins, to a file. Import replaces the current settings with those from a file.":
    "Export schreibt alle Einstellungen, auch die der Plugins, in eine Datei. Import ersetzt die aktuellen Einstellungen durch die aus einer Datei.",
  "Export settings": "Einstellungen exportieren",
  "Import settings": "Einstellungen importieren",
  "Open log": "Protokoll öffnen",
  "Settings exported.": "Einstellungen exportiert.",
  "Settings imported.": "Einstellungen importiert.",

  // What each plugin does
  "When a music video comes up, switches to its audio version. Saves bandwidth and processor time.":
    "Schaltet bei einem Musikvideo auf die Tonfassung um. Spart Bandbreite und Rechenzeit.",
  "Volume boost up to 300 %, left/right balance and mono.":
    "Lautstärke bis 300 %, Balance zwischen links und rechts und Mono.",
  "Evens out loud and quiet passages.":
    "Gleicht laute und leise Stellen an.",
  "The end of a track plays over the start of the next.":
    "Das Ende eines Titels läuft über den Anfang des nächsten.",
  "A working template for people who write plugins.":
    "Eine lauffähige Vorlage für alle, die Plugins schreiben.",
  "Ten bands with presets and a panel to adjust them.":
    "Zehn Bänder mit Presets und einem Panel zum Einstellen.",
  "Keeps boosted sound from distorting by holding its peaks just below the limit.":
    "Verhindert, dass angehobener Ton verzerrt, indem es die Spitzen knapp unter der Grenze hält.",
  "Time-synced lyrics in a side panel, from LRCLIB and lyrics.ovh.":
    "Songtexte im Takt in einem Seitenpanel, von LRCLIB und lyrics.ovh.",
  "Brings every track to the same loudness.":
    "Bringt alle Titel auf die gleiche Lautheit.",
  "Plays everything faster or slower.":
    "Spielt alles schneller oder langsamer ab.",
  "Makes the player choose Opus audio instead of AAC.":
    "Lässt den Player Opus statt AAC wählen.",
  "Skips tracks you gave a thumbs down.":
    "Überspringt Titel, denen du einen Daumen runter gegeben hast.",
  "Skips sponsors and non-music sections, using the SponsorBlock database.":
    "Überspringt Sponsoren und Abschnitte ohne Musik mit Hilfe der SponsorBlock-Datenbank.",
  "Color schemes, a glass effect, the cover as background and your own CSS.":
    "Farbschemata, Glas-Effekt, das Cover als Hintergrund und eigenes CSS.",
  "Fades each track out at its end and the next one in.":
    "Blendet jeden Titel am Ende aus und den nächsten ein.",
  "Codec, bitrate and loudness of the playing track, in a panel.":
    "Codec, Bitrate und Lautheit des laufenden Titels in einem Panel.",
  "The spectrum of the music as bars behind the player bar.":
    "Das Spektrum der Musik als Balken hinter der Player-Leiste.",
  "Changes the volume with the mouse wheel over the player bar.":
    "Ändert die Lautstärke mit dem Mausrad über der Player-Leiste.",

  // Units
  s: "s",
  px: "px",
  dB: "dB",
  "%": "%",
  "×": "×",

  // audio-tools
  "Volume boost": "Lautstärke-Verstärkung",
  "Above 100 % loud passages can distort.": "Über 100 % können laute Stellen verzerren.",
  Balance: "Balance",
  "Negative is left, positive is right.": "Negativ ist links, positiv ist rechts.",
  Mono: "Mono",
  "Plays both channels on both sides.": "Spielt beide Kanäle auf beiden Seiten.",

  // compressor
  Strength: "Stärke",
  "How much loud and quiet passages are evened out.": "Wie stark laute und leise Stellen angeglichen werden.",
  Light: "Leicht",
  Medium: "Mittel",
  Strong: "Stark",

  // crossfade
  Crossfade: "Überblendung",
  "How long two tracks overlap. In music videos the picture runs ahead of the sound by up to this much.":
    "Wie lange sich zwei Titel überlappen. Bei Musikvideos läuft das Bild dem Ton um bis zu so viel voraus.",

  // demo
  "Accent color": "Akzentfarbe",
  Red: "Rot",
  Blue: "Blau",
  Green: "Grün",
  "Button label": "Beschriftung des Knopfs",
  "Log songs": "Titel protokollieren",
  "Write every song change to the console.": "Schreibt jeden Titelwechsel in die Konsole.",

  // equalizer
  "Remember the preset per output device": "Preset je Ausgabegerät merken",
  "Switching to other headphones or speakers brings back the preset last chosen with them.":
    "Beim Wechsel auf andere Kopfhörer oder Lautsprecher kommt das Preset zurück, das zuletzt mit ihnen gewählt war.",

  // headphones
  "For headphones: mixes a little of each side into the other, as speakers do, and widens or narrows the stereo image.":
    "Für Kopfhörer: mischt jeder Seite etwas von der anderen bei, wie es Lautsprecher tun, und macht das Stereobild breiter oder schmaler.",
  "How much of the left channel reaches the right ear and the other way round. Takes away the hard left and right of old recordings. 0 is off.":
    "Wie viel vom linken Kanal das rechte Ohr erreicht und umgekehrt. Nimmt alten Aufnahmen das harte Links und Rechts. 0 ist aus.",
  Crossfeed: "Übersprechen (Crossfeed)",
  "Stereo width": "Stereobreite",
  "100 is unchanged, 0 is mono, 200 is as wide as it gets.": "100 ist unverändert, 0 ist Mono, 200 ist so breit wie möglich.",

  // lyrics
  "Font size": "Schriftgröße",
  "In pixels, 12 to 28.": "In Pixeln, 12 bis 28.",
  "Font size in the large view": "Schriftgröße in der großen Ansicht",
  "In pixels, 20 to 64.": "In Pixeln, 20 bis 64.",
  Shortcut: "Tastenkürzel",
  "Opens and closes the lyrics while the app's window has the focus.":
    "Öffnet und schließt die Songtexte, solange das Fenster der App den Fokus hat.",
  "Open on start": "Beim Start öffnen",
  "Show the lyrics panel when the app starts.": "Zeigt das Songtext-Panel, wenn die App startet.",

  // normalize
  Loudness: "Lautheit",
  "Every track is brought to this loudness. Quiet leaves the most room for tracks with loud peaks.":
    "Jeder Titel wird auf diese Lautheit gebracht. Leise lässt am meisten Luft für Titel mit lauten Spitzen.",
  Quiet: "Leise",
  Loud: "Laut",
  "Largest boost": "Größte Anhebung",
  "Quiet tracks are made louder by at most this much. More can distort their loudest moments.":
    "Leise Titel werden höchstens um so viel lauter gemacht. Mehr kann ihre lautesten Stellen verzerren.",

  // playback-speed
  Speed: "Geschwindigkeit",
  "Keep the pitch": "Tonhöhe beibehalten",
  "Off makes faster playback sound higher, like a record played too fast.":
    "Aus lässt schnellere Wiedergabe höher klingen, wie eine zu schnell gespielte Schallplatte.",

  // sponsorblock
  "Non-music sections": "Abschnitte ohne Musik",
  "Talking, skits and silence in music videos.": "Gerede, Sketche und Stille in Musikvideos.",
  Sponsors: "Sponsoren",
  "Self-promotion": "Eigenwerbung",
  "Interaction reminders": "Aufforderungen zum Mitmachen",
  "Requests to like, subscribe or follow.": "Bitten um Likes, Abos oder ums Folgen.",
  Intros: "Intros",
  "Outros and credits": "Outros und Abspann",
  "Show a notice when skipping": "Beim Überspringen einen Hinweis zeigen",
  "The notice says how long the section was and how much time was skipped so far. Its button plays the section after all.":
    "Der Hinweis nennt die Länge des Abschnitts und die bisher übersprungene Zeit. Sein Knopf spielt den Abschnitt doch ab.",

  // themes
  "Color scheme": "Farbschema",
  "YouTube Music": "YouTube Music",
  Black: "Schwarz",
  Slate: "Schiefer",
  "Midnight blue": "Mitternachtsblau",
  Forest: "Wald",
  Plum: "Pflaume",
  "From the cover": "Aus dem Cover",
  "Used for the progress bar and volume slider.": "Für den Fortschrittsbalken und den Lautstärkeregler.",
  Purple: "Lila",
  Orange: "Orange",
  Pink: "Pink",
  "Glass blur": "Glas-Effekt",
  "Makes the bars translucent and blurs what scrolls under them. 0 is off.":
    "Macht die Leisten durchscheinend und zeichnet weich, was darunter durchläuft. 0 ist aus.",
  "Cover art as background": "Cover als Hintergrund",
  "Shows the playing song's cover, blurred and darkened, behind the page.":
    "Zeigt das Cover des laufenden Titels unscharf und abgedunkelt hinter der Seite.",
  "Content width": "Inhaltsbreite",
  "How wide the page's content gets in a large window. Search results and playlist pages keep their own width.":
    "Wie breit der Inhalt der Seite in einem großen Fenster wird. Suchergebnisse und Playlist-Seiten behalten ihre eigene Breite.",
  Standard: "Standard",
  Narrow: "Schmal",
  "Full window": "Ganzes Fenster",
  "Custom CSS": "Eigenes CSS",
  "Applied after the theme.": "Wird nach dem Theme angewendet.",

  // track-fade
  "Fade out": "Ausblenden",
  "Seconds over which a track gets quieter at its end.": "Sekunden, über die ein Titel am Ende leiser wird.",
  "Fade in": "Einblenden",
  "Seconds over which a track gets louder at its start.": "Sekunden, über die ein Titel am Anfang lauter wird.",

  // visualizer
  Opacity: "Deckkraft",
  "How strongly the bars show behind the player bar.": "Wie deutlich die Balken hinter der Player-Leiste zu sehen sind.",

  // wheel-volume
  Step: "Schrittweite",
  "How far one notch of the mouse wheel changes the volume.":
    "Um wie viel eine Raste des Mausrads die Lautstärke ändert.",
  "Show the volume while changing it": "Lautstärke beim Ändern anzeigen",

  // updates
  Updates: "Updates",
  "Look for updates at start": "Beim Start nach Updates suchen",
  "Asks GitHub at each start whether there is a newer version. Nothing is installed without your click.":
    "Fragt bei jedem Start bei GitHub nach, ob es eine neuere Version gibt. Installiert wird erst auf deinen Klick.",
  "Version {version} is available.": "Version {version} ist verfügbar.",
  "Install and restart": "Installieren und neu starten",
  "Installing…": "Wird installiert…",
  "Looking…": "Suche läuft…",
  "Look now": "Jetzt suchen",
  "Installed: version {version}": "Installiert: Version {version}",
  "This is the newest version.": "Das ist die neueste Version.",
  "Could not check for updates: {reason}": "Die Suche nach Updates ist fehlgeschlagen: {reason}",
  "Could not install the update: {reason}": "Das Update ließ sich nicht installieren: {reason}",
};

export default de;

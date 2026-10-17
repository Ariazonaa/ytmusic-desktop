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
  "Start at sign-in": "Beim Anmelden starten",
  "Launch the app when you sign in.": "Startet die App, wenn du dich anmeldest.",
  "Start in the tray": "Im Tray starten",
  "When the app starts at sign-in, no window opens. Click the tray icon to show it.":
    "Startet die App bei der Anmeldung, öffnet sich kein Fenster. Ein Klick auf das Tray-Symbol zeigt es.",
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
  "Same as the system": "Wie das System",

  // Global shortcuts
  Shortcuts: "Tastenkürzel",
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
  "{keys} is taken by the app": "{keys} gehört der App",
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
  "Find plugins": "Plugins finden",
  "Plugins by others, from a list in the app's repository on GitHub. Loading the list asks GitHub for it, nothing more. Nobody checks the plugins: read what each one may do before you install it.":
    "Plugins von anderen, aus einer Liste im Repository der App auf GitHub. Zum Laden wird GitHub nach der Liste gefragt, sonst nichts. Niemand prüft die Plugins: Lies vor dem Installieren, was jedes darf.",
  "Load the list": "Liste laden",
  "Load again": "Neu laden",
  "Loading…": "Lädt…",
  "The list is empty so far.": "Die Liste ist bisher leer.",
  "Could not load the list: {reason}": "Die Liste ließ sich nicht laden: {reason}",
  Installed: "Installiert",
  "Update to {version}": "Auf {version} aktualisieren",
  "Updated {name} to {version}.": "{name} auf {version} aktualisiert.",
  Install: "Installieren",
  "More about it": "Mehr dazu",
  Remove: "Entfernen",
  "Really remove? Its files are deleted.": "Wirklich entfernen? Seine Dateien werden gelöscht.",
  "Removed {name}.": "{name} entfernt.",
  "Could not remove the plugin: {reason}": "Das Plugin ließ sich nicht entfernen: {reason}",
  "Reload plugins": "Plugins neu laden",
  "Switched off {names}, which cannot run together with {name}.":
    "{names} ausgeschaltet, weil es nicht zusammen mit {name} laufen kann.",
  " and ": " und ",

  // Backup and log
  Backup: "Sicherung",
  "Export writes all settings, including those of the plugins, to a file. Import replaces the current settings with those from a file.":
    "Export schreibt alle Einstellungen, auch die der Plugins, in eine Datei. Import ersetzt die aktuellen Einstellungen durch die aus einer Datei.",
  "Export settings": "Einstellungen exportieren",
  "Import settings": "Einstellungen importieren",
  "Open log": "Protokoll öffnen",
  "Settings exported.": "Einstellungen exportiert.",
  "Settings imported.": "Einstellungen importiert.",

  // What each plugin does
  "Music videos without the video: switches to the audio version, or without Premium loads the smallest picture and shows the cover.":
    "Musikvideos ohne Video: wechselt zur Audio-Version, oder lädt ohne Premium das kleinste Bild und zeigt das Cover.",
  "Presses Yes when YouTube Music stops and asks whether to go on playing.":
    "Drückt „Ja“, wenn YouTube Music anhält und fragt, ob es weiterspielen soll.",
  "Shows in your Discord profile what you are listening to, with cover, progress and a button to listen along. Your friends on Discord see it.":
    "Zeigt in deinem Discord-Profil, was du hörst, mit Cover, Fortschritt und einem Knopf zum Mithören. Deine Freunde auf Discord sehen das.",
  "Name in the member list": "Name in der Mitgliederliste",
  'What your friends see next to your name, after "Listening to".':
    "Was deine Freunde neben deinem Namen sehen, nach „Hört“.",
  "The artist": "Den Künstler",
  "The title": "Den Titel",
  "Show the cover": "Cover zeigen",
  "Show how far the track is": "Fortschritt des Titels zeigen",
  "Title and artist open YouTube Music": "Titel und Künstler öffnen YouTube Music",
  "Clicking the title opens the track, clicking the artist searches for them.":
    "Ein Klick auf den Titel öffnet ihn, ein Klick auf den Künstler sucht nach ihm.",
  "Small icon on the cover": "Kleines Symbol auf dem Cover",
  "The app's icon; hovering it shows whether you like the track.":
    "Das Symbol der App; darüber steht, ob dir der Titel gefällt.",
  'Button "Listen on YouTube Music"': "Knopf „Auf YouTube Music anhören“",
  'Button "Get the app"': "Knopf „Hol dir die App“",
  "Leads to this app's page on GitHub.": "Führt zur Seite dieser App auf GitHub.",
  "While paused": "Bei Pause",
  "Show nothing": "Nichts zeigen",
  "Keep the track, marked as paused": "Titel stehen lassen, als pausiert markiert",
  Preview: "Vorschau",
  "Preview: what Discord shows right now.": "Vorschau: Das zeigt Discord gerade.",
  "Preview with a sample track: Discord shows nothing right now.":
    "Vorschau mit einem Beispieltitel: Discord zeigt gerade nichts.",
  "Listening to {name}": "Hört {name}",
  "Listening to {name} now": "Hört {name} zu",
  "On the small icon: {text}": "Am kleinen Symbol: {text}",
  "You, in the member list": "Du, in der Mitgliederliste",
  "The buttons show to others only; Discord leaves them out of your own profile.":
    "Die Knöpfe sehen nur andere; im eigenen Profil lässt Discord sie weg.",
  Paused: "Pausiert",
  "You like this track": "Gefällt dir",
  "Listen on YouTube Music": "Auf YouTube Music anhören",
  "Get the app": "Hol dir die App",
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
  "Removes the ads YouTube Music plays between tracks without Premium.":
    "Entfernt die Werbung, die YouTube Music ohne Premium zwischen Titeln spielt.",
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
  "Opens and closes the equalizer while the app's window has the focus.":
    "Öffnet und schließt den Equalizer, solange das Fenster der App den Fokus hat.",
  "Opens and closes the themes while the app's window has the focus.":
    "Öffnet und schließt die Themes, solange das Fenster der App den Fokus hat.",
  Everywhere: "Überall",
  "Window over other programs": "Fenster über anderen Programmen",
  "The line being sung in a small window that stays on top, e.g. over a game. Drag it where you like.":
    "Die gesungene Zeile in einem kleinen Fenster, das oben bleibt, etwa über einem Spiel. Schieb es, wohin du willst.",
  "Translate into": "Übersetzen in",
  "Shows each line's translation under it, from MyMemory, which gets the lyrics for it. About 5000 characters a day are free, a few songs' worth.":
    "Zeigt unter jeder Zeile ihre Übersetzung, von MyMemory, das dafür den Songtext bekommt. Etwa 5000 Zeichen am Tag sind frei, ein paar Lieder.",
  "No translation": "Keine Übersetzung",
  German: "Deutsch",
  English: "Englisch",
  Spanish: "Spanisch",
  French: "Französisch",
  Italian: "Italienisch",
  Portuguese: "Portugiesisch",
  Dutch: "Niederländisch",
  Polish: "Polnisch",
  Turkish: "Türkisch",
  Japanese: "Japanisch",
  Korean: "Koreanisch",
  "Runs fast through silence at the start of a track, and goes on to the next one when the end is silence.":
    "Spielt Stille am Anfang eines Titels schnell durch und geht zum nächsten, wenn das Ende still ist.",
  "At the start": "Am Anfang",
  "Silence in the first 15 seconds plays at triple speed, which nobody hears.":
    "Stille in den ersten 15 Sekunden läuft dreifach schnell, was niemand hört.",
  "At the end": "Am Ende",
  "Silence of a second and a half in the last 20 seconds goes on to the next track.":
    "Anderthalb Sekunden Stille in den letzten 20 Sekunden führen zum nächsten Titel.",
  "Silence below": "Stille unter",
  "Lower counts less as silence: a quiet intro stays.": "Je niedriger, desto weniger gilt als Stille: ein leises Intro bleibt.",
  "Saves the open playlist as a text file or as a CSV for a spreadsheet, and lists the tracks that are in it more than once.":
    "Speichert die offene Playlist als Textdatei oder als CSV für eine Tabelle und zeigt, welche Titel mehrfach darin sind.",
  "Your most heard tracks and artists and your listening time per day, counted on this computer only.":
    "Deine meistgehörten Titel und Künstler und deine Hörzeit je Tag, gezählt nur auf diesem Computer.",
  "Hands the playing track to streaming software such as OBS: as text files and a cover in a folder, and if you like as a page for a browser source.":
    "Gibt den laufenden Titel an Streaming-Software wie OBS: als Textdateien und Cover in einem Ordner, und auf Wunsch als Seite für eine Browserquelle.",
  Text: "Text",
  "What now-playing.txt says. {title}, {artist} and {album} stand for the track.":
    "Was in now-playing.txt steht. {title}, {artist} und {album} stehen für den Titel.",
  "Page for a browser source": "Seite für eine Browserquelle",
  "Cover and track on http://127.0.0.1 at the port below, for OBS's browser source. Only this computer can open it.":
    "Cover und Titel unter http://127.0.0.1 am Port darunter, für die Browserquelle von OBS. Nur dieser Computer kann sie öffnen.",
  Port: "Port",
  "Shows the cover of the playing track large, and saves it as a picture.":
    "Zeigt das Cover des laufenden Titels groß und speichert es als Bild.",
  "Shows the cover over the whole window, and hides it again, while the app's window has the focus.":
    "Zeigt das Cover über dem ganzen Fenster und blendet es wieder aus, solange das Fenster der App den Fokus hat.",
  "Plays music and podcasts faster or slower, each at its own speed.":
    "Spielt Musik und Podcasts schneller oder langsamer, jedes mit eigener Geschwindigkeit.",
  "For songs and music videos. A speed chosen in YouTube Music's menu is kept here.":
    "Für Songs und Musikvideos. Eine im Menü von YouTube Music gewählte Geschwindigkeit wird hier übernommen.",
  "Speed for podcasts": "Geschwindigkeit für Podcasts",
  "For podcast episodes. A speed chosen in YouTube Music's menu while one plays is kept here.":
    "Für Podcast-Folgen. Eine im Menü von YouTube Music gewählte Geschwindigkeit wird hier übernommen, während eine läuft.",
  Lyrics: "Songtext",
  Equalizer: "Equalizer",
  Themes: "Themes",
  "In the app's window": "Im Fenster der App",
  Like: "Mag ich",
  Dislike: "Mag ich nicht",
  "Likes the playing track, or takes the like back.": "Markiert den laufenden Titel mit „Mag ich“, oder nimmt das zurück.",
  "Dislikes the playing track, or takes it back.": "Markiert den laufenden Titel mit „Mag ich nicht“, oder nimmt das zurück.",
  "Opens and closes its panel.": "Öffnet und schließt sein Panel.",
  "Opens and closes its panel, while the plugin {name} is on.": "Öffnet und schließt sein Panel, solange das Plugin {name} an ist.",
  "These work while the app's window has the focus, except while you type in a field.":
    "Diese gelten, solange das Fenster der App den Fokus hat, außer beim Tippen in einem Feld.",
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

  // tabs and the list of plugins
  All: "Alle",
  "Switched on ({count})": "Eingeschaltet ({count})",
  "Settings and details": "Einstellungen und Details",
  Details: "Details",
  "Version {version}": "Version {version}",
  "Plugins from others": "Plugins von anderen",

  // updates
  Updates: "Updates",
  "Look for updates at start": "Beim Start nach Updates suchen",
  "Asks GitHub at each start whether there is a newer version. Nothing is installed without your click.":
    "Fragt bei jedem Start bei GitHub nach, ob es eine neuere Version gibt. Installiert wird erst auf deinen Klick.",
  "Version {version} is available.": "Version {version} ist verfügbar.",
  "Install and restart": "Installieren und neu starten",
  "Installing…": "Wird installiert…",
  "Open the download page": "Download-Seite öffnen",
  "The download page is open in your browser. A copy from the zip is replaced by unpacking the new one over it; a package for Linux is updated by your package manager.":
    "Die Download-Seite ist im Browser offen. Eine Kopie aus dem ZIP ersetzt du, indem du das neue darüber entpackst; ein Paket für Linux aktualisiert deine Paketverwaltung.",
  "Looking…": "Suche läuft…",
  "Look now": "Jetzt suchen",
  "Installed: version {version}": "Installiert: Version {version}",
  "This is the newest version.": "Das ist die neueste Version.",
  "Could not check for updates: {reason}": "Die Suche nach Updates ist fehlgeschlagen: {reason}",
  "Could not install the update: {reason}": "Das Update ließ sich nicht installieren: {reason}",
};

export default de;

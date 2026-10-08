//! System tray icon with playback controls.

use crate::window::{self, PlayerAction};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const APP_NAME: &str = "YouTube Music";
const NOTHING_PLAYING: &str = "Nothing playing";
/// Windows shows at most 127 characters of a tooltip.
const MAX_TOOLTIP_CHARS: usize = 120;
const MAX_MENU_CHARS: usize = 80;

/// The menu's entries, by their id and their English text.
const ENTRIES: [(&str, &str); 9] = [
    ("show", "Show"),
    ("settings", "Settings"),
    ("play-pause", "Play / Pause"),
    ("next", "Next"),
    ("previous", "Previous"),
    ("volume-up", "Volume up"),
    ("volume-down", "Volume down"),
    ("mute", "Mute / Unmute"),
    ("quit", "Quit"),
];

/// A menu text in the given language. English texts are the keys.
fn text(german: bool, english: &'static str) -> &'static str {
    if !german {
        return english;
    }
    match english {
        "Show" => "Anzeigen",
        "Settings" => "Einstellungen",
        "Play / Pause" => "Wiedergabe / Pause",
        "Next" => "Weiter",
        "Previous" => "Zurück",
        "Volume up" => "Lauter",
        "Volume down" => "Leiser",
        "Mute / Unmute" => "Stumm / Laut",
        "Quit" => "Beenden",
        "Nothing playing" => "Es läuft nichts",
        other => other,
    }
}

/// Whether the `language` setting, or else the system, asks for German.
pub fn wants_german(setting: &str, system_locale: Option<&str>) -> bool {
    match setting {
        "de" => true,
        "en" => false,
        _ => system_locale.is_some_and(|locale| locale.to_lowercase().starts_with("de")),
    }
}

/// The parts of the tray that change: the line for the playing song and the
/// entries' texts.
pub struct NowPlaying {
    tray: TrayIcon,
    line: MenuItem<tauri::Wry>,
    entries: Vec<(MenuItem<tauri::Wry>, &'static str)>,
    /// The song shown, and whether the menu is in German.
    state: Mutex<(Option<String>, bool)>,
}

/// `language` is the setting: `system`, `en` or `de`.
pub fn create(app: &AppHandle, language: &str) -> tauri::Result<()> {
    let german = wants_german(language, sys_locale::get_locale().as_deref());
    // A line to read, not to click.
    let now_playing = MenuItem::with_id(
        app,
        "now-playing",
        text(german, NOTHING_PLAYING),
        false,
        None::<&str>,
    )?;
    let mut entries = Vec::new();
    for (id, english) in ENTRIES {
        let item = MenuItem::with_id(app, id, text(german, english), true, None::<&str>)?;
        entries.push((item, english));
    }
    let entry = |index: usize| &entries[index].0;
    let menu = Menu::with_items(
        app,
        &[
            &now_playing,
            &PredefinedMenuItem::separator(app)?,
            entry(0),
            entry(1),
            &PredefinedMenuItem::separator(app)?,
            entry(2),
            entry(3),
            entry(4),
            &PredefinedMenuItem::separator(app)?,
            entry(5),
            entry(6),
            entry(7),
            &PredefinedMenuItem::separator(app)?,
            entry(8),
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(APP_NAME)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => window::show_main_window(app),
            "settings" => window::open_settings_window(app),
            "play-pause" => window::control_player(app, PlayerAction::PlayPause),
            "next" => window::control_player(app, PlayerAction::Next),
            "previous" => window::control_player(app, PlayerAction::Previous),
            "volume-up" => window::control_player(app, PlayerAction::VolumeUp),
            "volume-down" => window::control_player(app, PlayerAction::VolumeDown),
            "mute" => window::control_player(app, PlayerAction::ToggleMute),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                window::show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    let tray = tray.build(app)?;
    app.manage(NowPlaying {
        tray,
        line: now_playing,
        entries,
        state: Mutex::new((None, german)),
    });
    Ok(())
}

/// Puts the menu into the language the setting asks for.
pub fn set_language(app: &AppHandle, language: &str) {
    let Some(tray) = app.try_state::<NowPlaying>() else {
        return;
    };
    let german = wants_german(language, sys_locale::get_locale().as_deref());
    let song = {
        let mut state = tray.state.lock().unwrap_or_else(|err| err.into_inner());
        if state.1 == german {
            return;
        }
        state.1 = german;
        state.0.clone()
    };
    let mut result = Ok(());
    for (item, english) in &tray.entries {
        result = result.and(item.set_text(text(german, english)));
    }
    if song.is_none() {
        result = result.and(tray.line.set_text(text(german, NOTHING_PLAYING)));
    }
    if let Err(err) = result {
        log_error!("cannot update the tray: {err}");
    }
}

/// Shows the playing song in the tooltip and as the first line of the menu.
/// An empty title means nothing is playing.
pub fn set_now_playing(app: &AppHandle, title: &str, artist: &str) {
    let Some(state) = app.try_state::<NowPlaying>() else {
        return;
    };
    let song = describe(title, artist);
    let german = {
        let mut current = state.state.lock().unwrap_or_else(|err| err.into_inner());
        current.0.clone_from(&song);
        current.1
    };
    let tooltip = match &song {
        Some(song) => shorten(&format!("{song}\n{APP_NAME}"), MAX_TOOLTIP_CHARS),
        None => APP_NAME.to_owned(),
    };
    let line = song.map_or_else(
        || text(german, NOTHING_PLAYING).to_owned(),
        |song| shorten(&song.replace('&', "&&"), MAX_MENU_CHARS),
    );
    let result = state
        .tray
        .set_tooltip(Some(tooltip))
        .and_then(|()| state.line.set_text(line));
    if let Err(err) = result {
        log_error!("cannot update the tray: {err}");
    }
}

/// `Artist – Title`, on one line. `None` without a title.
fn describe(title: &str, artist: &str) -> Option<String> {
    let clean = |text: &str| -> String {
        let spaced: String = text
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect();
        spaced.split_whitespace().collect::<Vec<_>>().join(" ")
    };
    let (title, artist) = (clean(title), clean(artist));
    match (title.is_empty(), artist.is_empty()) {
        (true, _) => None,
        (false, true) => Some(title),
        (false, false) => Some(format!("{artist} – {title}")),
    }
}

fn shorten(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_owned();
    }
    let mut short: String = text.chars().take(max_chars - 1).collect();
    short.push('…');
    short
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describes_the_song_on_one_line() {
        assert_eq!(
            describe("Never Gonna\nGive You Up ", " Rick  Astley"),
            Some("Rick Astley – Never Gonna Give You Up".into())
        );
        assert_eq!(describe("Title", ""), Some("Title".into()));
        assert_eq!(describe("", "Artist"), None);
        assert_eq!(describe(" \t", ""), None);
    }

    #[test]
    fn german_follows_the_setting_and_else_the_system() {
        assert!(wants_german("de", Some("en-US")));
        assert!(!wants_german("en", Some("de-DE")));
        assert!(wants_german("system", Some("de-AT")));
        assert!(wants_german("system", Some("DE")));
        assert!(!wants_german("system", Some("fr-FR")));
        assert!(!wants_german("system", None));
    }

    #[test]
    fn every_entry_has_a_german_text() {
        for (_, english) in ENTRIES {
            assert_ne!(text(true, english), english, "{english}");
            assert_eq!(text(false, english), english);
        }
        assert_eq!(text(true, NOTHING_PLAYING), "Es läuft nichts");
    }

    #[test]
    fn shortens_long_texts() {
        assert_eq!(shorten("short", 10), "short");
        assert_eq!(shorten("ääääääääääää", 5), "ääää…");
        assert_eq!(shorten(&"x".repeat(500), 120).chars().count(), 120);
    }
}

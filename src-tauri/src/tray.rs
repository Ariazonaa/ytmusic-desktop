//! System tray icon with playback controls.

use crate::settings::Settings;
use crate::sleep::{self, Sleep};
use crate::window::{self, PlayerAction};
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const APP_NAME: &str = "YouTube Music";
const NOTHING_PLAYING: &str = "Nothing playing";
const ALWAYS_ON_TOP: &str = "Always on top";
/// Windows shows at most 127 characters of a tooltip.
const MAX_TOOLTIP_CHARS: usize = 120;
const MAX_MENU_CHARS: usize = 80;

/// The menu's entries, by their id and their English text.
const ENTRIES: [(&str, &str); 10] = [
    ("show", "Show"),
    ("settings", "Settings"),
    ("play-pause", "Play / Pause"),
    ("next", "Next"),
    ("previous", "Previous"),
    ("volume-up", "Volume up"),
    ("volume-down", "Volume down"),
    ("mute", "Mute / Unmute"),
    ("quit", "Quit"),
    ("mini-player", "Mini player"),
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
        "Mini player" => "Mini-Player",
        "Always on top" => "Immer im Vordergrund",
        "Nothing playing" => "Es läuft nichts",
        "Sleep timer" => "Schlaf-Timer",
        "Off" => "Aus",
        "At the end of the track" => "Am Ende des Titels",
        "Output" => "Ausgabe",
        "System default" => "Systemstandard",
        other => other,
    }
}

/// The sleep timer's choices: the menu entry's id and what it sets.
fn sleep_choices() -> Vec<(String, Sleep)> {
    let mut choices = vec![("sleep-off".to_owned(), Sleep::Off)];
    for minutes in sleep::MINUTES {
        choices.push((
            format!("sleep-{minutes}"),
            Sleep::After(std::time::Duration::from_secs(minutes * 60)),
        ));
    }
    choices.push(("sleep-end".to_owned(), Sleep::TrackEnd));
    choices
}

fn sleep_label(german: bool, choice: Sleep) -> String {
    match choice {
        Sleep::Off => text(german, "Off").to_owned(),
        Sleep::TrackEnd => text(german, "At the end of the track").to_owned(),
        Sleep::After(after) => {
            let minutes = after.as_secs() / 60;
            if german {
                format!("{minutes} Minuten")
            } else {
                format!("{minutes} minutes")
            }
        }
    }
}

/// The submenu's title, with what is set: minutes left or the end of the track.
fn sleep_title(german: bool, left: Option<u64>, at_end: bool) -> String {
    let title = text(german, "Sleep timer");
    match (left, at_end, german) {
        (Some(minutes), _, false) => format!("{title} ({minutes} min left)"),
        (Some(minutes), _, true) => format!("{title} (noch {minutes} Min.)"),
        (None, true, false) => format!("{title} (end of track)"),
        (None, true, true) => format!("{title} (Ende des Titels)"),
        (None, false, _) => title.to_owned(),
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
    on_top: CheckMenuItem<tauri::Wry>,
    sleep_menu: Submenu<tauri::Wry>,
    sleep_items: Vec<(CheckMenuItem<tauri::Wry>, Sleep)>,
    #[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
    menu: Menu<tauri::Wry>,
    /// The devices to play on, filled in once known (Linux only so far).
    output_menu: Submenu<tauri::Wry>,
    /// The entries in it by the device's name; empty for the system's default.
    output_items: Mutex<Vec<(CheckMenuItem<tauri::Wry>, String)>>,
    /// The song shown, and whether the menu is in German.
    state: Mutex<(Option<String>, bool)>,
    /// What the sleep timer's title shows: minutes left, or the end of the track.
    sleep_shown: Mutex<(Option<u64>, bool)>,
}

pub fn create(app: &AppHandle, settings: &Settings) -> tauri::Result<()> {
    let german = wants_german(&settings.language, sys_locale::get_locale().as_deref());
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
    let on_top = CheckMenuItem::with_id(
        app,
        "always-on-top",
        text(german, ALWAYS_ON_TOP),
        true,
        settings.always_on_top,
        None::<&str>,
    )?;
    let mut sleep_items = Vec::new();
    for (id, choice) in sleep_choices() {
        let item = CheckMenuItem::with_id(
            app,
            id,
            sleep_label(german, choice),
            true,
            choice == Sleep::Off,
            None::<&str>,
        )?;
        sleep_items.push((item, choice));
    }
    let sleep_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = sleep_items
        .iter()
        .map(|(item, _)| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let sleep_menu = Submenu::with_id_and_items(
        app,
        "sleep",
        sleep_title(german, None, false),
        true,
        &sleep_refs,
    )?;
    // Empty and hidden until the devices are known: a submenu cannot be hidden,
    // so it is added to the menu then.
    let output_menu = Submenu::with_id(app, "output", text(german, "Output"), true)?;
    let entry = |index: usize| &entries[index].0;
    let menu = Menu::with_items(
        app,
        &[
            &now_playing,
            &PredefinedMenuItem::separator(app)?,
            entry(0),
            entry(1),
            entry(9),
            &on_top,
            &PredefinedMenuItem::separator(app)?,
            entry(2),
            entry(3),
            entry(4),
            &sleep_menu,
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
            "mini-player" => crate::mini::toggle(app),
            id if id.starts_with(OUTPUT_PREFIX) => {
                let chosen = app.try_state::<NowPlaying>().and_then(|tray| {
                    let items = tray
                        .output_items
                        .lock()
                        .unwrap_or_else(|err| err.into_inner());
                    items
                        .iter()
                        .find(|(item, _)| item.id().as_ref() == id)
                        .map(|(_, name)| name.clone())
                });
                if let Some(name) = chosen {
                    crate::commands::set_output_device(app, &name);
                }
            }
            id if id.starts_with("sleep-") => {
                if let Some(choice) = sleep_choices()
                    .into_iter()
                    .find(|(choice_id, _)| choice_id == id)
                    .map(|(_, choice)| choice)
                {
                    sleep::set(app, choice);
                }
            }
            "always-on-top" => {
                // The menu has ticked or unticked the entry already.
                if let Some(tray) = app.try_state::<NowPlaying>() {
                    let on = tray.on_top.is_checked().unwrap_or(false);
                    crate::commands::set_always_on_top(app, on);
                }
            }
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
        on_top,
        sleep_menu,
        sleep_items,
        menu,
        output_menu,
        output_items: Mutex::new(Vec::new()),
        state: Mutex::new((None, german)),
        sleep_shown: Mutex::new((None, false)),
    });
    Ok(())
}

/// Whether the tray icon is there: it is missing when it could not be made.
pub fn exists(app: &AppHandle) -> bool {
    app.try_state::<NowPlaying>().is_some()
}

const OUTPUT_PREFIX: &str = "output-";

/// Fills the submenu of devices to play on, ticking the chosen one, and puts
/// it into the menu the first time (above the volume).
#[cfg_attr(not(any(target_os = "linux", windows)), allow(dead_code))]
pub fn set_outputs(app: &AppHandle, outputs: &[crate::audio_output::Output], chosen: &str) {
    let Some(tray) = app.try_state::<NowPlaying>() else {
        return;
    };
    let german = tray.state.lock().unwrap_or_else(|err| err.into_inner()).1;
    let mut items = tray
        .output_items
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    let result = (|| -> tauri::Result<()> {
        for (item, _) in items.drain(..) {
            tray.output_menu.remove(&item)?;
        }
        let choices = std::iter::once((String::new(), text(german, "System default").to_owned()))
            .chain(
                outputs
                    .iter()
                    .map(|output| (output.name.clone(), output.label.clone())),
            );
        for (index, (name, label)) in choices.enumerate() {
            let item = CheckMenuItem::with_id(
                app,
                format!("{OUTPUT_PREFIX}{index}"),
                label,
                true,
                name == chosen,
                None::<&str>,
            )?;
            tray.output_menu.append(&item)?;
            items.push((item, name));
        }
        let menu = &tray.menu;
        if !menu
            .items()?
            .iter()
            .any(|item| item.id() == tray.output_menu.id())
        {
            // Right after the sleep timer.
            let at = menu
                .items()?
                .iter()
                .position(|item| item.id() == tray.sleep_menu.id())
                .map_or(0, |at| at + 1);
            menu.insert(&tray.output_menu, at)?;
        }
        Ok(())
    })();
    if let Err(err) = result {
        log_error!("tray: cannot list the sound devices: {err}");
    }
}

/// Ticks the entry of the chosen device, and only that one.
pub fn tick_output(app: &AppHandle, chosen: &str) {
    let Some(tray) = app.try_state::<NowPlaying>() else {
        return;
    };
    let items = tray
        .output_items
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    for (item, name) in items.iter() {
        if let Err(err) = item.set_checked(name == chosen) {
            log_error!("tray: {err}");
        }
    }
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
    result = result.and(tray.on_top.set_text(text(german, ALWAYS_ON_TOP)));
    for (item, choice) in &tray.sleep_items {
        result = result.and(item.set_text(sleep_label(german, *choice)));
    }
    let (left, at_end) = *tray
        .sleep_shown
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    result = result.and(tray.sleep_menu.set_text(sleep_title(german, left, at_end)));
    result = result.and(tray.output_menu.set_text(text(german, "Output")));
    for (item, name) in tray
        .output_items
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .iter()
    {
        if name.is_empty() {
            result = result.and(item.set_text(text(german, "System default")));
        }
    }
    if song.is_none() {
        result = result.and(tray.line.set_text(text(german, NOTHING_PLAYING)));
    }
    if let Err(err) = result {
        log_error!("cannot update the tray: {err}");
    }
}

/// Ticks the sleep timer's entry for what is set (none for a time set from
/// outside that the menu does not offer) and puts it in the title.
pub fn set_sleep(app: &AppHandle, set: Sleep) {
    let Some(tray) = app.try_state::<NowPlaying>() else {
        return;
    };
    let mut result = Ok(());
    for (item, choice) in &tray.sleep_items {
        result = result.and(item.set_checked(*choice == set));
    }
    *tray
        .sleep_shown
        .lock()
        .unwrap_or_else(|err| err.into_inner()) = (None, set == Sleep::TrackEnd);
    let german = tray.state.lock().unwrap_or_else(|err| err.into_inner()).1;
    result = result.and(tray.sleep_menu.set_text(sleep_title(
        german,
        None,
        set == Sleep::TrackEnd,
    )));
    if let Err(err) = result {
        log_error!("cannot update the tray: {err}");
    }
}

/// The minutes the sleep timer has left, in the submenu's title.
pub fn set_sleep_left(app: &AppHandle, minutes: Option<u64>) {
    let Some(tray) = app.try_state::<NowPlaying>() else {
        return;
    };
    let at_end = {
        let mut shown = tray
            .sleep_shown
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        shown.0 = minutes;
        shown.1
    };
    let german = tray.state.lock().unwrap_or_else(|err| err.into_inner()).1;
    if let Err(err) = tray
        .sleep_menu
        .set_text(sleep_title(german, minutes, at_end))
    {
        log_error!("cannot update the tray: {err}");
    }
}

/// Ticks "Always on top" as the setting says, also after a change elsewhere.
pub fn set_always_on_top(app: &AppHandle, on: bool) {
    let Some(tray) = app.try_state::<NowPlaying>() else {
        return;
    };
    if let Err(err) = tray.on_top.set_checked(on) {
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
        assert_eq!(text(true, ALWAYS_ON_TOP), "Immer im Vordergrund");
        for (_, choice) in sleep_choices() {
            assert_ne!(sleep_label(true, choice), sleep_label(false, choice));
        }
    }

    #[test]
    fn sleep_timer_titles() {
        assert_eq!(sleep_title(false, None, false), "Sleep timer");
        assert_eq!(
            sleep_title(false, Some(23), false),
            "Sleep timer (23 min left)"
        );
        assert_eq!(
            sleep_title(true, Some(23), false),
            "Schlaf-Timer (noch 23 Min.)"
        );
        assert_eq!(
            sleep_title(true, None, true),
            "Schlaf-Timer (Ende des Titels)"
        );
        assert_eq!(
            sleep_label(false, Sleep::After(std::time::Duration::from_secs(1800))),
            "30 minutes"
        );
        assert_eq!(sleep_choices().len(), 2 + sleep::MINUTES.len());
    }

    #[test]
    fn shortens_long_texts() {
        assert_eq!(shorten("short", 10), "short");
        assert_eq!(shorten("ääääääääääää", 5), "ääää…");
        assert_eq!(shorten(&"x".repeat(500), 120).chars().count(), 120);
    }
}

//! Global keyboard shortcuts: they work while another program has the focus
//! and while the app sits in the tray.

use crate::settings::Shortcuts;
use crate::window::{self, PlayerAction};
use std::str::FromStr;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const MAX_SHORTCUT_LEN: usize = 64;

/// The configurable shortcuts with a name for messages and what they do.
fn entries(shortcuts: &Shortcuts) -> [(&'static str, &str, PlayerAction); 6] {
    [
        (
            "play / pause",
            &shortcuts.play_pause,
            PlayerAction::PlayPause,
        ),
        ("next", &shortcuts.next, PlayerAction::Next),
        ("previous", &shortcuts.previous, PlayerAction::Previous),
        ("volume up", &shortcuts.volume_up, PlayerAction::VolumeUp),
        (
            "volume down",
            &shortcuts.volume_down,
            PlayerAction::VolumeDown,
        ),
        ("mute", &shortcuts.toggle_mute, PlayerAction::ToggleMute),
    ]
}

/// Parses the shortcuts that are set. An empty one is switched off.
fn parse(shortcuts: &Shortcuts) -> Result<Vec<(Shortcut, PlayerAction)>, String> {
    let mut parsed: Vec<(Shortcut, PlayerAction)> = Vec::new();
    for (name, keys, action) in entries(shortcuts) {
        if keys.is_empty() {
            continue;
        }
        if keys.len() > MAX_SHORTCUT_LEN {
            return Err(format!("the shortcut for {name} is too long"));
        }
        let shortcut = Shortcut::from_str(keys)
            .map_err(|err| format!("invalid shortcut for {name} ({keys}): {err}"))?;
        if parsed.iter().any(|(other, _)| *other == shortcut) {
            return Err(format!("{keys} is used for two actions"));
        }
        parsed.push((shortcut, action));
    }
    Ok(parsed)
}

pub fn validate(shortcuts: &Shortcuts) -> Result<(), String> {
    parse(shortcuts).map(|_| ())
}

/// Replaces the registered shortcuts with the given ones. Fails if one of
/// them cannot be taken, usually because another program holds it. Nothing is
/// registered then.
pub fn apply(app: &AppHandle, shortcuts: &Shortcuts) -> Result<(), String> {
    let parsed = parse(shortcuts)?;
    let global = app.global_shortcut();
    global.unregister_all().map_err(|err| err.to_string())?;
    for (shortcut, action) in parsed {
        let registered = global.on_shortcut(shortcut, move |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                window::control_player(app, action);
            }
        });
        if let Err(err) = registered {
            // Half a set would be confusing: all or none.
            let _ = global.unregister_all();
            return Err(format!(
                "cannot use {shortcut} as a shortcut, it may belong to another program ({err})"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shortcuts(up: &str, down: &str, mute: &str) -> Shortcuts {
        Shortcuts {
            volume_up: up.into(),
            volume_down: down.into(),
            toggle_mute: mute.into(),
            ..Shortcuts::default()
        }
    }

    #[test]
    fn none_set_is_valid() {
        assert!(validate(&Shortcuts::default()).is_ok());
    }

    #[test]
    fn accepts_shortcuts_as_the_settings_window_writes_them() {
        assert!(validate(&shortcuts(
            "Ctrl+Alt+ArrowUp",
            "Ctrl+Alt+ArrowDown",
            "Ctrl+Alt+KeyM"
        ))
        .is_ok());
        assert!(validate(&shortcuts("Ctrl+Shift+F9", "", "Super+Alt+Digit0")).is_ok());
    }

    /// Every key the settings window can produce (`src/ui/shortcut.ts`) must
    /// be understood here, or the user could pick a shortcut that cannot be saved.
    #[test]
    fn understands_every_key_the_settings_window_offers() {
        let mut keys: Vec<String> = Vec::new();
        keys.extend(('A'..='Z').map(|letter| format!("Key{letter}")));
        keys.extend((0..=9).map(|digit| format!("Digit{digit}")));
        keys.extend((0..=9).map(|digit| format!("Numpad{digit}")));
        keys.extend((1..=24).map(|number| format!("F{number}")));
        keys.extend(
            [
                "ArrowUp",
                "ArrowDown",
                "ArrowLeft",
                "ArrowRight",
                "PageUp",
                "PageDown",
                "Home",
                "End",
                "Insert",
                "Space",
                "Minus",
                "Equal",
                "Comma",
                "Period",
                "Slash",
                "Backslash",
                "Semicolon",
                "Quote",
                "BracketLeft",
                "BracketRight",
                "Backquote",
                "NumpadAdd",
                "NumpadSubtract",
                "NumpadMultiply",
                "NumpadDivide",
            ]
            .map(String::from),
        );
        for key in keys {
            let combination = format!("Ctrl+Alt+{key}");
            assert!(
                Shortcut::from_str(&combination).is_ok(),
                "{combination} is not understood"
            );
        }
        for modifiers in ["Ctrl", "Alt", "Shift", "Super", "Ctrl+Alt+Shift+Super"] {
            let combination = format!("{modifiers}+F5");
            assert!(Shortcut::from_str(&combination).is_ok(), "{combination}");
        }
    }

    #[test]
    fn playback_shortcuts_count_for_duplicates_too() {
        let clash = Shortcuts {
            play_pause: "Ctrl+Alt+KeyP".into(),
            toggle_mute: "Ctrl+Alt+KeyP".into(),
            ..Shortcuts::default()
        };
        assert!(validate(&clash).is_err());
        let fine = Shortcuts {
            play_pause: "Ctrl+Alt+KeyP".into(),
            next: "Ctrl+Alt+ArrowRight".into(),
            previous: "Ctrl+Alt+ArrowLeft".into(),
            ..Shortcuts::default()
        };
        assert!(validate(&fine).is_ok());
    }

    #[test]
    fn rejects_nonsense_duplicates_and_overlong_input() {
        assert!(validate(&shortcuts("Ctrl+Alt+NoSuchKey", "", "")).is_err());
        assert!(validate(&shortcuts("Ctrl+Alt+ArrowUp", "Ctrl+Alt+ArrowUp", "")).is_err());
        // The same keys written differently are still the same shortcut.
        assert!(validate(&shortcuts("Ctrl+Alt+KeyM", "", "Alt+Ctrl+KeyM")).is_err());
        assert!(validate(&shortcuts(&"A".repeat(65), "", "")).is_err());
    }
}

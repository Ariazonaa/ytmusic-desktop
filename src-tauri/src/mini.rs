//! The mini player: a small window above other programs with the cover, the
//! track, its progress and the buttons. It shows what the page reports to the
//! tray and the taskbar (`set_now_playing`, `set_playback`), which is kept
//! here for when the window opens.

use crate::window::{self, PlayerAction};
use serde::Serialize;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const MINI_WINDOW_LABEL: &str = "mini-player";
const MAX_TEXT_CHARS: usize = 200;

/// What the mini player shows. `at` is when `position` was true, in
/// milliseconds since 1970, so that the window counts on from there.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct MiniState {
    pub title: String,
    pub artist: String,
    pub cover: Option<String>,
    pub paused: bool,
    pub position: f64,
    pub duration: Option<f64>,
    pub at: u64,
}

#[derive(Default)]
pub struct MiniPlayer(Mutex<MiniState>);

impl MiniPlayer {
    fn change(&self, change: impl FnOnce(&mut MiniState)) -> MiniState {
        let mut state = self.0.lock().unwrap_or_else(|err| err.into_inner());
        change(&mut state);
        state.clone()
    }

    pub fn current(&self) -> MiniState {
        self.0.lock().unwrap_or_else(|err| err.into_inner()).clone()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as u64)
        .unwrap_or(0)
}

fn cut(text: &str) -> String {
    text.chars().take(MAX_TEXT_CHARS).collect()
}

/// A new track: its texts, and its cover if it is one from YouTube's image servers.
pub fn set_track(app: &AppHandle, title: &str, artist: &str, cover: Option<&str>) {
    let state = app.state::<MiniPlayer>().change(|state| {
        state.title = cut(title);
        state.artist = cut(artist);
        state.cover = cover
            .filter(|url| crate::cover::is_cover_url(url))
            .map(str::to_owned);
    });
    send(app, &state);
}

/// How far the track is and whether it plays.
pub fn set_playback(app: &AppHandle, paused: bool, position: f64, duration: Option<f64>) {
    let state = app.state::<MiniPlayer>().change(|state| {
        state.paused = paused;
        state.position = position;
        state.duration = duration;
        state.at = now_ms();
    });
    send(app, &state);
}

fn send(app: &AppHandle, state: &MiniState) {
    if app.get_webview_window(MINI_WINDOW_LABEL).is_none() {
        return;
    }
    if let Err(err) = app.emit_to(MINI_WINDOW_LABEL, "mini-state", state) {
        log_error!("cannot update the mini player: {err}");
    }
}

/// The mini player's buttons, by the names its page uses.
pub fn action(name: &str) -> Option<PlayerAction> {
    match name {
        "previous" => Some(PlayerAction::Previous),
        "playPause" => Some(PlayerAction::PlayPause),
        "next" => Some(PlayerAction::Next),
        _ => None,
    }
}

/// Opens the mini player, or closes it if it is open.
pub fn toggle(app: &AppHandle) {
    show(app, app.get_webview_window(MINI_WINDOW_LABEL).is_none());
}

pub fn show(app: &AppHandle, open: bool) {
    match (open, app.get_webview_window(MINI_WINDOW_LABEL)) {
        (false, Some(mini)) => {
            if let Err(err) = mini.close() {
                log_error!("cannot close the mini player: {err}");
            }
        }
        (true, Some(mini)) => {
            let _ = mini.show();
            let _ = mini.set_focus();
        }
        (true, None) => {
            // As with the other windows: built on a thread of its own.
            let app = app.clone();
            std::thread::spawn(move || {
                let result = crate::portable::webview(WebviewWindowBuilder::new(
                    &app,
                    MINI_WINDOW_LABEL,
                    WebviewUrl::App("mini.html".into()),
                ))
                .title("Mini player")
                .theme(Some(tauri::Theme::Dark))
                .additional_browser_args(window::browser_args(&app))
                .inner_size(380.0, 104.0)
                .min_inner_size(300.0, 96.0)
                .max_inner_size(900.0, 160.0)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .build();
                match result {
                    Ok(mini) => window::keep_above(mini),
                    Err(err) => log_error!("cannot open the mini player: {err}"),
                }
            });
        }
        (false, None) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_its_buttons_only() {
        assert_eq!(action("next"), Some(PlayerAction::Next));
        assert_eq!(action("playPause"), Some(PlayerAction::PlayPause));
        assert_eq!(action("previous"), Some(PlayerAction::Previous));
        assert_eq!(action("volumeUp"), None);
        assert_eq!(action("pause"), None);
    }

    #[test]
    fn keeps_texts_short_and_covers_from_youtube_only() {
        let player = MiniPlayer::default();
        let state = player.change(|state| {
            state.title = cut(&"x".repeat(500));
            state.cover = Some("https://evil.example/a.jpg")
                .filter(|url| crate::cover::is_cover_url(url))
                .map(str::to_owned);
        });
        assert_eq!(state.title.chars().count(), MAX_TEXT_CHARS);
        assert_eq!(state.cover, None);
        let json = serde_json::to_value(player.current()).unwrap();
        for key in [
            "title", "artist", "cover", "paused", "position", "duration", "at",
        ] {
            assert!(json.get(key).is_some(), "{key}");
        }
    }
}

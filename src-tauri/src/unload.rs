//! Saves memory while the app waits in the tray: after a pause of some
//! minutes there (setting `unloadAfterMinutes`, off by default), with no
//! window of it shown, the page is left for an empty one. It comes back when
//! the window shows, a player action asks for it or a link opens; the track
//! it had is put back paused (`player/resume.ts`), and a Play / Pause that
//! woke it plays.

use crate::settings::SettingsStore;
use crate::window::{self, PlayerAction, MAIN_WINDOW_LABEL};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Url};

const LOOK_EVERY: Duration = Duration::from_secs(20);
pub const MAX_MINUTES: u16 = 240;

#[derive(Default)]
struct State {
    /// Since when nothing has played; none while something plays.
    idle_since: Option<Instant>,
    unloaded: bool,
    /// What woke the page, done once its track is back.
    pending: Option<Pending>,
}

#[derive(Clone, Copy)]
struct Pending {
    action: PlayerAction,
    woke: Instant,
    /// When it was last sent to the page: Play is sent again until it plays.
    sent: Option<Instant>,
}

pub struct Unloader(Mutex<State>);

impl Default for Unloader {
    fn default() -> Self {
        // Nothing plays at the start.
        Self(Mutex::new(State {
            idle_since: Some(Instant::now()),
            ..State::default()
        }))
    }
}

/// Works on the state under its lock.
fn with<R>(app: &AppHandle, change: impl FnOnce(&mut State) -> R) -> R {
    let unloader = app.state::<Unloader>();
    let mut state = unloader.0.lock().unwrap_or_else(|err| err.into_inner());
    change(&mut state)
}

/// Whether the page may go: it is time, and no one looks at the app.
fn due(idle_for: Option<Duration>, minutes: u16, shown: bool) -> bool {
    minutes > 0
        && !shown
        && idle_for.is_some_and(|idle| idle >= Duration::from_secs(u64::from(minutes) * 60))
}

/// How long after waking the page may take to put its track back.
const RESTORE_TIME: Duration = Duration::from_secs(15);

/// Whether the action that woke the page is due: its track is back at its
/// place, or the page had its time. Done earlier, it would count as the
/// user's own doing, and the page would leave the track where it was.
fn track_back(position: f64, has_track: bool, since_wake: Duration) -> bool {
    has_track && (position > 1.0 || since_wake >= RESTORE_TIME)
}

/// How long Play is tried after waking, and how often.
const GIVE_UP: Duration = Duration::from_secs(45);
const PLAY_AGAIN: Duration = Duration::from_secs(3);

#[derive(Debug, PartialEq, Eq)]
enum Step {
    Wait,
    /// Send it, and keep it for the next report.
    Send,
    /// Send it, and that was it.
    SendOnce,
    Done,
}

/// What to do about the action that woke the page, at a report of the page.
/// Play is sent until the page says it plays: the page may still hold its
/// track paused when the first one arrives. Playing counts only once Play was
/// sent, as the page may start the track by itself and hold it paused right
/// after.
fn next_step(pending: &Pending, paused: bool, position: f64, has_track: bool) -> Step {
    if pending.woke.elapsed() >= GIVE_UP {
        return Step::Done;
    }
    if !track_back(position, has_track, pending.woke.elapsed()) {
        return Step::Wait;
    }
    if pending.action != PlayerAction::Play {
        return Step::SendOnce;
    }
    match pending.sent {
        Some(_) if !paused => Step::Done,
        None if !paused => Step::Wait,
        Some(sent) if sent.elapsed() < PLAY_AGAIN => Step::Wait,
        _ => Step::Send,
    }
}

/// What the page reports about playback. Once the track is back after
/// waking, the action that woke it is done.
pub fn playback(app: &AppHandle, paused: bool, position: f64, has_track: bool) {
    let send = with(app, |state| {
        if paused {
            state.idle_since.get_or_insert_with(Instant::now);
        } else {
            state.idle_since = None;
        }
        let pending = state.pending.as_mut()?;
        match next_step(pending, paused, position, has_track) {
            Step::Wait => None,
            Step::Send => {
                pending.sent = Some(Instant::now());
                Some(pending.action)
            }
            Step::SendOnce => state.pending.take().map(|pending| pending.action),
            Step::Done => {
                state.pending = None;
                None
            }
        }
    });
    if let Some(action) = send {
        window::control_player(app, action);
    }
}

fn shown(app: &AppHandle) -> bool {
    [MAIN_WINDOW_LABEL, crate::mini::MINI_WINDOW_LABEL]
        .iter()
        .filter_map(|label| app.get_webview_window(label))
        .any(|window| window.is_visible().unwrap_or(true))
}

fn unload(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    // The next visit counts as the app's start, so the track is put back.
    let forget_start = "try { sessionStorage.removeItem('ytmd-started') } catch {}";
    let blank: Url = "about:blank".parse().expect("the blank URL is valid");
    let result = window
        .eval(forget_start)
        .and_then(|()| window.navigate(blank));
    match result {
        Ok(()) => with(app, |state| state.unloaded = true),
        Err(err) => log_error!("cannot unload the page: {err}"),
    }
}

/// Brings the page back if it was unloaded, at `to` or the home page, and
/// keeps `then` for when it plays again. False if it was there all along.
pub fn wake(app: &AppHandle, to: Option<Url>, then: Option<PlayerAction>) -> bool {
    let was_unloaded = with(app, |state| {
        if !state.unloaded {
            return false;
        }
        state.unloaded = false;
        state.idle_since = Some(Instant::now());
        state.pending = then.map(|action| Pending {
            action,
            woke: Instant::now(),
            sent: None,
        });
        true
    });
    if !was_unloaded {
        return false;
    }
    let url = to.unwrap_or_else(|| window::YTM_URL.parse().expect("the start URL is valid"));
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if let Err(err) = window.navigate(url) {
            log_error!("cannot load the page again: {err}");
        }
    }
    true
}

/// A player action while the page is away: Play / Pause (which can only
/// mean play then), Next and Previous bring it back and are done then, the
/// others have nothing to act on. False if the page is there.
pub fn wake_for(app: &AppHandle, action: PlayerAction) -> bool {
    match action {
        PlayerAction::PlayPause => wake(app, None, Some(PlayerAction::Play)),
        PlayerAction::Next | PlayerAction::Previous => wake(app, None, Some(action)),
        _ => with(app, |state| state.unloaded),
    }
}

/// Looks now and then whether the page can go.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(LOOK_EVERY);
        let minutes = app.state::<SettingsStore>().get().unload_after_minutes;
        let Some(idle_for) = with(&app, |state| {
            (!state.unloaded).then(|| state.idle_since.map(|since| since.elapsed()))
        }) else {
            continue;
        };
        if due(idle_for, minutes, shown(&app)) {
            unload(&app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn goes_only_when_idle_long_enough_and_unseen() {
        let half_hour = Some(Duration::from_secs(30 * 60));
        assert!(due(half_hour, 30, false));
        assert!(!due(half_hour, 0, false), "off");
        assert!(!due(half_hour, 31, false), "not yet");
        assert!(!due(half_hour, 30, true), "a window is shown");
        assert!(!due(None, 1, false), "something plays");
    }

    #[test]
    fn waits_for_the_track_before_playing_it() {
        let soon = Duration::from_secs(2);
        assert!(!track_back(0.0, false, soon), "no track yet");
        assert!(!track_back(0.0, true, soon), "not at its place yet");
        assert!(track_back(83.4, true, soon), "back at its place");
        assert!(
            track_back(0.0, true, RESTORE_TIME),
            "a track that starts at its beginning"
        );
        assert!(!track_back(83.4, false, RESTORE_TIME));
    }

    fn pending(action: PlayerAction, woke_ago: u64, sent_ago: Option<u64>) -> Pending {
        let ago = |seconds| Instant::now() - Duration::from_secs(seconds);
        Pending {
            action,
            woke: ago(woke_ago),
            sent: sent_ago.map(ago),
        }
    }

    #[test]
    fn plays_until_the_page_says_it_plays() {
        let play = |sent_ago| pending(PlayerAction::Play, 5, sent_ago);
        assert_eq!(
            next_step(&play(None), true, 0.0, false),
            Step::Wait,
            "no track yet"
        );
        assert_eq!(next_step(&play(None), true, 48.0, true), Step::Send);
        assert_eq!(
            next_step(&play(None), false, 48.0, true),
            Step::Wait,
            "plays before any Play: the page starts it by itself and holds it paused right after"
        );
        assert_eq!(
            next_step(&play(Some(1)), true, 48.0, true),
            Step::Wait,
            "just sent"
        );
        assert_eq!(
            next_step(&play(Some(4)), true, 48.0, true),
            Step::Send,
            "still held paused"
        );
        assert_eq!(
            next_step(&play(Some(1)), false, 49.0, true),
            Step::Done,
            "plays"
        );
        let late = pending(PlayerAction::Play, 50, Some(4));
        assert_eq!(next_step(&late, true, 48.0, true), Step::Done, "gave up");
        let next = pending(PlayerAction::Next, 5, None);
        assert_eq!(next_step(&next, true, 48.0, true), Step::SendOnce);
    }
}

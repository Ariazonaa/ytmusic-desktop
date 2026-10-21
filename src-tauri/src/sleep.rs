//! The sleep timer: pauses playback after a time, or at the end of the
//! playing track. Set in the tray menu or with `--sleep=` (see `parse`).
//! It only ever pauses, so it never starts what was stopped already.

use crate::window::{self, PlayerAction, MAIN_WINDOW_LABEL};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// The choices in the tray menu, in minutes.
pub const MINUTES: [u64; 5] = [15, 30, 45, 60, 90];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sleep {
    Off,
    /// Pause after this long.
    After(Duration),
    /// Pause as the playing track ends.
    TrackEnd,
}

/// What `--sleep=` asks for: `off`, `end`, minutes such as `30`, or seconds such as `20s`.
pub fn parse(value: &str) -> Option<Sleep> {
    match value {
        "off" => Some(Sleep::Off),
        "end" => Some(Sleep::TrackEnd),
        _ => {
            let (number, seconds) = match value.strip_suffix('s') {
                Some(number) => (number, 1),
                None => (value, 60),
            };
            let amount: u64 = number
                .parse()
                .ok()
                .filter(|&n| n > 0 && n <= 24 * 60 * 60)?;
            Some(Sleep::After(Duration::from_secs(amount * seconds)))
        }
    }
}

/// The sleep timer asked for among the program's arguments, as `--sleep=30`.
pub fn from_args(args: impl IntoIterator<Item = String>) -> Option<Sleep> {
    args.into_iter()
        .find_map(|arg| arg.strip_prefix("--sleep=").and_then(parse))
}

/// Whole minutes left, rounded up, for the tray: "1" until the very end.
pub fn minutes_left(left: Duration) -> u64 {
    left.as_secs().div_ceil(60).max(1)
}

#[derive(Default)]
pub struct SleepTimer {
    /// When a timer by time ends, and a number that changes with every
    /// setting so that a waiting thread knows it was replaced.
    state: Mutex<(Option<Instant>, u64)>,
}

impl SleepTimer {
    fn lock(&self) -> std::sync::MutexGuard<'_, (Option<Instant>, u64)> {
        self.state.lock().unwrap_or_else(|err| err.into_inner())
    }
}

/// Sets the timer; whatever was set before stops.
pub fn set(app: &AppHandle, sleep: Sleep) {
    let timer = app.state::<SleepTimer>();
    let generation = {
        let mut state = timer.lock();
        state.1 += 1;
        state.0 = match sleep {
            Sleep::After(after) => Some(Instant::now() + after),
            _ => None,
        };
        state.1
    };
    at_track_end(app, sleep == Sleep::TrackEnd);
    crate::tray::set_sleep(app, sleep);
    if let Sleep::After(after) = sleep {
        crate::tray::set_sleep_left(app, Some(minutes_left(after)));
        let app = app.clone();
        std::thread::spawn(move || run(&app, generation));
    }
}

/// Waits for the end, showing the minutes left; stops when replaced.
fn run(app: &AppHandle, generation: u64) {
    let timer = app.state::<SleepTimer>();
    let mut shown = 0;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let (end, current) = {
            let state = timer.lock();
            (state.0, state.1)
        };
        if current != generation {
            return;
        }
        let Some(end) = end else {
            return;
        };
        let now = Instant::now();
        if now >= end {
            window::control_player(app, PlayerAction::Pause);
            done(app);
            return;
        }
        let minutes = minutes_left(end - now);
        if minutes != shown {
            shown = minutes;
            crate::tray::set_sleep_left(app, Some(minutes));
        }
    }
}

/// The timer has paused playback: it is off again.
pub fn done(app: &AppHandle) {
    {
        let timer = app.state::<SleepTimer>();
        let mut state = timer.lock();
        state.0 = None;
        state.1 += 1;
    }
    crate::tray::set_sleep(app, Sleep::Off);
}

/// Tells the page to pause at the end of the playing track, or not to.
fn at_track_end(app: &AppHandle, on: bool) {
    let Some(page) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    if let Err(err) = page.eval(format!("window.__ytmDesktop?.sleepAtTrackEnd?.({on})")) {
        log_error!("cannot set the sleep timer in the page: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_sleep_argument() {
        let args = |list: &[&str]| list.iter().map(|arg| arg.to_string()).collect::<Vec<_>>();
        assert_eq!(
            from_args(args(&["--sleep=30"])),
            Some(Sleep::After(Duration::from_secs(1800)))
        );
        assert_eq!(
            from_args(args(&["--next", "--sleep=20s"])),
            Some(Sleep::After(Duration::from_secs(20)))
        );
        assert_eq!(from_args(args(&["--sleep=end"])), Some(Sleep::TrackEnd));
        assert_eq!(from_args(args(&["--sleep=off"])), Some(Sleep::Off));
        for wrong in [
            "--sleep=0",
            "--sleep=-5",
            "--sleep=soon",
            "--sleep=",
            "--sleep",
            "--sleep=99999999",
        ] {
            assert_eq!(from_args(args(&[wrong])), None, "{wrong}");
        }
    }

    #[test]
    fn counts_minutes_left_upwards() {
        assert_eq!(minutes_left(Duration::from_secs(1800)), 30);
        assert_eq!(minutes_left(Duration::from_secs(1741)), 30);
        assert_eq!(minutes_left(Duration::from_secs(61)), 2);
        assert_eq!(minutes_left(Duration::from_secs(5)), 1);
        assert_eq!(minutes_left(Duration::ZERO), 1);
    }
}

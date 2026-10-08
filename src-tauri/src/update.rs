//! Updates: asks the project's releases whether there is a newer version, and
//! installs it when the user says so.
//!
//! The address and the key that every update has to be signed with are in
//! `tauri.conf.json`. Nothing is downloaded or installed without a click in
//! the settings window.

use crate::settings::SettingsStore;
use crate::window;
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The check at start waits this long: the page has to load first, and the
/// notice about an update needs it.
const START_DELAY: Duration = Duration::from_secs(25);
const MAX_NOTES_CHARS: usize = 2000;

/// The update found by the last check.
#[derive(Default)]
pub struct UpdateStore(Mutex<Option<Update>>);

/// What the settings window shows about an update.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    /// What changed, as the release says it.
    pub notes: String,
}

fn info(version: &str, notes: Option<&str>) -> UpdateInfo {
    UpdateInfo {
        version: version.to_owned(),
        notes: notes
            .unwrap_or_default()
            .trim()
            .chars()
            .take(MAX_NOTES_CHARS)
            .collect(),
    }
}

fn stored(app: &AppHandle) -> Option<Update> {
    let store = app.try_state::<UpdateStore>()?;
    let update = store.0.lock().unwrap_or_else(|err| err.into_inner());
    update.clone()
}

/// The update the last check found, without asking again.
pub fn pending(app: &AppHandle) -> Option<UpdateInfo> {
    stored(app).map(|update| info(&update.version, update.body.as_deref()))
}

/// Asks the releases for a newer version. `None` means this is the newest.
pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|err| err.to_string())?
        .check()
        .await
        .map_err(|err| err.to_string())?;
    let found = update
        .as_ref()
        .map(|update| info(&update.version, update.body.as_deref()));
    if let Some(store) = app.try_state::<UpdateStore>() {
        *store.0.lock().unwrap_or_else(|err| err.into_inner()) = update;
    }
    Ok(found)
}

/// Downloads the update the last check found, checks its signature, installs
/// it and starts the new version.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let update = stored(app).ok_or("no update was found")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| err.to_string())?;
    app.restart()
}

/// Checks once, a while after the start, if the user has not switched that
/// off, and tells the page about a newer version.
pub fn check_at_start(app: &AppHandle) {
    // A development build is not installed and cannot replace itself.
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(START_DELAY);
        if !app.state::<SettingsStore>().get().check_for_updates {
            return;
        }
        match tauri::async_runtime::block_on(check(&app)) {
            Ok(Some(update)) => window::update_available(&app, &update.version),
            Ok(None) => {}
            // No connection is no reason for a line in the log at every start.
            Err(_) => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_are_trimmed_and_bounded() {
        assert_eq!(
            info("1.2.3", Some("  - one\n- two\n")),
            UpdateInfo {
                version: "1.2.3".into(),
                notes: "- one\n- two".into()
            }
        );
        assert_eq!(info("1.2.3", None).notes, "");
        assert_eq!(
            info("1.2.3", Some(&"ä".repeat(5000))).notes.chars().count(),
            MAX_NOTES_CHARS
        );
    }
}

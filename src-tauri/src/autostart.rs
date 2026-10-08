//! Keeps the OS autostart entry in line with the `startup` setting.

use tauri::AppHandle;

/// Passed to the app when the OS launches it at sign-in.
pub const ARGUMENT: &str = "--autostart";

/// Whether this run was started by the OS at sign-in.
pub fn launched_at_sign_in() -> bool {
    std::env::args().any(|argument| argument == ARGUMENT)
}
use tauri_plugin_autostart::ManagerExt;

pub fn sync(app: &AppHandle, enabled: bool) {
    // A dev build would register the debug binary to launch at sign-in.
    if cfg!(debug_assertions) {
        return;
    }
    let autolaunch = app.autolaunch();
    if !enabled && autolaunch.is_enabled().ok() == Some(false) {
        return;
    }
    // Enabling again rewrites the entry, so one made by an older version
    // gets the argument that marks a launch at sign-in.
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    if let Err(err) = result {
        log_error!("cannot update autostart: {err}");
    }
}

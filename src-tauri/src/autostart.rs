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
    match result {
        Err(err) => log_error!("cannot update autostart: {err}"),
        #[cfg(windows)]
        Ok(()) if enabled => quote_entry(&app.package_info().name),
        Ok(()) => {}
    }
}

/// The command line of the autostart entry: the path in quotes, so that a
/// folder with a space in its name cannot be read as another program.
#[cfg(any(windows, test))]
fn command_line(program: &str) -> String {
    format!("\"{program}\" {ARGUMENT}")
}

/// The autostart library writes the path without quotes; this writes the
/// entry again with them.
#[cfg(windows)]
fn quote_entry(name: &str) {
    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    let result = std::env::current_exe()
        .map_err(|err| err.to_string())
        .and_then(|program| {
            let key = windows_registry::CURRENT_USER
                .create(RUN)
                .map_err(|err| err.to_string())?;
            key.set_string(name, command_line(&program.display().to_string()))
                .map_err(|err| err.to_string())
        });
    if let Err(err) = result {
        log_error!("cannot write the autostart entry: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_the_path_in_the_autostart_entry() {
        assert_eq!(
            command_line(r"C:\Users\A B\AppData\Local\YouTube Music Desktop\ytmusic-desktop.exe"),
            r#""C:\Users\A B\AppData\Local\YouTube Music Desktop\ytmusic-desktop.exe" --autostart"#
        );
    }
}

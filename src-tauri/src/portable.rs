//! Portable mode: with a file `portable` or `portable.txt` next to the
//! program, everything the app keeps (settings, plugins, log, the web view's
//! data with the login) is in the folder `ytmusic-desktop-data` beside it
//! instead of the user's profile. For an AppImage "next to the program" is
//! next to the AppImage file, as the program itself is inside it.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime, WebviewWindowBuilder};

const MARKERS: [&str; 2] = ["portable", "portable.txt"];
pub const DATA_FOLDER: &str = "ytmusic-desktop-data";
const WEBVIEW_FOLDER: &str = "webview";

/// The folder the program is in, as the user sees it.
fn program_dir() -> Option<PathBuf> {
    if cfg!(target_os = "linux") {
        if let Some(appimage) = std::env::var_os("APPIMAGE") {
            return Path::new(&appimage).parent().map(Path::to_path_buf);
        }
    }
    std::env::current_exe()
        .ok()?
        .parent()
        .map(Path::to_path_buf)
}

/// The data folder if `dir` holds a marker, made if it is not there yet.
/// A folder that cannot be made, say under Program Files, is no data folder.
fn data_dir_in(dir: &Path) -> Result<Option<PathBuf>, String> {
    if !MARKERS.iter().any(|marker| dir.join(marker).is_file()) {
        return Ok(None);
    }
    let data = dir.join(DATA_FOLDER);
    std::fs::create_dir_all(&data)
        .map(|()| Some(data.clone()))
        .map_err(|err| format!("cannot use {}: {err}", data.display()))
}

/// Decided once, at the first call.
fn decided() -> &'static Result<Option<PathBuf>, String> {
    static DIR: OnceLock<Result<Option<PathBuf>, String>> = OnceLock::new();
    DIR.get_or_init(|| match program_dir() {
        Some(dir) => data_dir_in(&dir),
        None => Ok(None),
    })
}

/// The portable data folder, or none when the app keeps its data as usual.
pub fn data_dir() -> Option<&'static Path> {
    decided().as_ref().ok().and_then(Option::as_deref)
}

/// Why portable mode is off although a marker is there, for the log.
pub fn problem() -> Option<&'static str> {
    decided().as_ref().err().map(String::as_str)
}

/// Where settings, plugins, the log and the rest are kept.
pub fn config_dir<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    match data_dir() {
        Some(dir) => Ok(dir.to_path_buf()),
        None => app.path().app_config_dir(),
    }
}

/// Every window keeps its web data in the portable folder too; on Windows
/// all of them have to name the same folder to share one browser.
pub fn webview<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    match data_dir() {
        Some(dir) => builder.data_directory(dir.join(WEBVIEW_FOLDER)),
        None => builder,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_off_without_a_marker() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(data_dir_in(dir.path()), Ok(None));
        assert!(!dir.path().join(DATA_FOLDER).exists());
    }

    #[test]
    fn takes_either_marker_and_makes_the_folder() {
        for marker in MARKERS {
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(dir.path().join(marker), "").unwrap();
            let data = data_dir_in(dir.path()).unwrap().unwrap();
            assert_eq!(data, dir.path().join(DATA_FOLDER));
            assert!(data.is_dir());
        }
    }

    #[test]
    fn a_folder_named_like_a_marker_is_none() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("portable")).unwrap();
        assert_eq!(data_dir_in(dir.path()), Ok(None));
    }

    #[test]
    fn says_why_when_the_folder_cannot_be_made() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("portable"), "").unwrap();
        // A file where the folder should be.
        std::fs::write(dir.path().join(DATA_FOLDER), "").unwrap();
        assert!(data_dir_in(dir.path()).is_err());
    }
}

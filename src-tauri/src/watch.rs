//! For plugin authors: reloads the external plugins when a file in the
//! plugins folder changes, so that an edit shows up without a click.
//!
//! The folder is looked at every second and a half rather than watched:
//! change notifications are unreliable on network drives, and a few dozen
//! small files cost nothing to list.

use crate::{plugins, settings::SettingsStore, window};
use std::{
    fs,
    path::Path,
    thread,
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager};

const INTERVAL: Duration = Duration::from_millis(1500);
/// Folders inside folders are followed this far down.
const MAX_DEPTH: usize = 3;
const MAX_FILES: usize = 2000;

/// Every file under `dir` with its size and the time it was changed, sorted.
/// Two listings differ exactly when a file was added, removed or changed.
pub fn fingerprint(dir: &Path) -> Vec<(String, u64, Option<SystemTime>)> {
    let mut files = Vec::new();
    collect(dir, dir, 0, &mut files);
    files.sort();
    files
}

fn collect(
    root: &Path,
    dir: &Path,
    depth: usize,
    files: &mut Vec<(String, u64, Option<SystemTime>)>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if files.len() >= MAX_FILES {
            return;
        }
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            if depth < MAX_DEPTH {
                collect(root, &path, depth + 1, files);
            }
        } else {
            let name = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();
            files.push((name, metadata.len(), metadata.modified().ok()));
        }
    }
}

/// Starts looking at the plugins folder. The setting is read each time, so
/// switching it on or off takes effect at once.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mut last = None;
        loop {
            thread::sleep(INTERVAL);
            let enabled = app.state::<SettingsStore>().get().reload_plugins_on_change;
            let Some(dir) = plugins::dir(&app).filter(|_| enabled) else {
                // Forget the listing, so that switching on does not reload at once.
                last = None;
                continue;
            };
            let now = fingerprint(&dir);
            if last.as_ref().is_some_and(|before| before != &now) {
                window::reload_plugins(&app);
            }
            last = Some(now);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_when_a_file_is_added_changed_or_removed() {
        let dir = tempfile::tempdir().unwrap();
        let plugin = dir.path().join("hello");
        fs::create_dir_all(plugin.join("lib")).unwrap();
        fs::write(plugin.join("index.js"), "// one").unwrap();
        let first = fingerprint(dir.path());
        assert_eq!(first.len(), 1);
        assert_eq!(fingerprint(dir.path()), first);

        fs::write(plugin.join("lib").join("util.js"), "// util").unwrap();
        let added = fingerprint(dir.path());
        assert_ne!(added, first);

        fs::write(plugin.join("index.js"), "// one, but longer").unwrap();
        let changed = fingerprint(dir.path());
        assert_ne!(changed, added);

        fs::remove_file(plugin.join("lib").join("util.js")).unwrap();
        assert_ne!(fingerprint(dir.path()), changed);
    }

    #[test]
    fn a_missing_folder_has_no_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(fingerprint(&dir.path().join("missing")).is_empty());
    }
}

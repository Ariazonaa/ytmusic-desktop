//! Updates: asks the project's releases whether there is a newer version, and
//! installs it when the user says so.
//!
//! The address and the key that every update has to be signed with are in
//! `tauri.conf.json`. That address is the newest regular release, which GitHub
//! never takes a test version for; with `betaUpdates` the newest release of
//! all, betas too, is looked up and asked instead. Nothing is downloaded or
//! installed without a click in the settings window.

use crate::settings::SettingsStore;
use crate::window;
use serde::{Deserialize, Serialize};
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};

/// The check at start waits this long: the page has to load first, and the
/// notice about an update needs it.
const START_DELAY: Duration = Duration::from_secs(25);
const MAX_NOTES_CHARS: usize = 2000;
const REPOSITORY: &str = "https://github.com/Ariazonaa/ytmusic-desktop";
/// The newest releases, betas and drafts among them, newest first.
const RELEASE_LIST: &str =
    "https://api.github.com/repos/Ariazonaa/ytmusic-desktop/releases?per_page=30";
const MAX_RELEASE_LIST_BYTES: usize = 2_000_000;
/// Every release has it: what installed apps ask for.
const UPDATE_FILE: &str = "latest.json";

/// A release as GitHub's API lists it, as far as it is needed here.
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

/// The update file of the highest version among the published releases,
/// test versions included. A release comes after its betas.
fn newest_update_file(releases: &[Release]) -> Option<String> {
    releases
        .iter()
        .filter(|release| !release.draft)
        .filter_map(|release| {
            let tag = release
                .tag_name
                .strip_prefix('v')
                .unwrap_or(&release.tag_name);
            let version = semver::Version::parse(tag).ok()?;
            let file = release
                .assets
                .iter()
                .find(|asset| asset.name == UPDATE_FILE)?;
            Some((version, file.browser_download_url.clone()))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, url)| url)
}

/// Where a copy that is not installed gets `version`: its own release, as
/// "latest" never is a beta.
fn release_page(version: &str) -> String {
    format!("{REPOSITORY}/releases/tag/v{version}")
}

/// The address to ask with betas: the newest release's update file.
async fn beta_endpoint() -> Result<tauri::Url, String> {
    let list = crate::download::fetch(RELEASE_LIST, MAX_RELEASE_LIST_BYTES).await?;
    let releases: Vec<Release> =
        serde_json::from_slice(&list).map_err(|err| format!("the release list: {err}"))?;
    let url = newest_update_file(&releases).ok_or("no release has an update file")?;
    url.parse().map_err(|err| format!("{url}: {err}"))
}

/// The update found by the last check.
#[derive(Default)]
pub struct UpdateStore(Mutex<Option<Update>>);

/// What the settings window shows about an update.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    /// What changed, as the release says it.
    pub notes: String,
    /// This copy was not installed, it came from the portable zip: the
    /// updater would run the installer and leave this copy as it is, so the
    /// new version is fetched from the release page by hand.
    pub by_hand: bool,
}

/// Whether this copy can replace itself. On Windows: set up by the installer,
/// which puts its uninstaller next to the program; the portable zip has none.
/// On Linux only the AppImage can, which its runtime tells through
/// `APPIMAGE`; a package from the distribution's tools is updated by them.
fn installed() -> bool {
    if cfg!(target_os = "linux") {
        return std::env::var_os("APPIMAGE").is_some();
    }
    if !cfg!(windows) {
        return true;
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").is_file()))
        .unwrap_or(true)
}

fn info(version: &str, notes: Option<&str>) -> UpdateInfo {
    UpdateInfo {
        by_hand: !installed(),
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
    let mut builder = app.updater_builder();
    if app.state::<SettingsStore>().get().beta_updates {
        builder = builder
            .endpoints(vec![beta_endpoint().await?])
            .map_err(|err| err.to_string())?;
    }
    let update = builder
        .build()
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
/// it and starts the new version. A copy that cannot replace itself opens the
/// release page instead.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let update = stored(app).ok_or("no update was found")?;
    if !installed() {
        return app
            .opener()
            .open_url(release_page(&update.version), None::<&str>)
            .map_err(|err| err.to_string());
    }
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
                notes: "- one\n- two".into(),
                by_hand: !installed()
            }
        );
        assert_eq!(info("1.2.3", None).notes, "");
        assert_eq!(
            info("1.2.3", Some(&"ä".repeat(5000))).notes.chars().count(),
            MAX_NOTES_CHARS
        );
    }

    fn release(tag: &str, draft: bool, files: &[&str]) -> Release {
        Release {
            tag_name: tag.into(),
            draft,
            assets: files
                .iter()
                .map(|name| Asset {
                    name: (*name).into(),
                    browser_download_url: format!("https://example.org/{tag}/{name}"),
                })
                .collect(),
        }
    }

    #[test]
    fn the_newest_release_counts_test_versions_too() {
        let releases = [
            release("v0.9.0", false, &["latest.json", "a.deb"]),
            release("v0.10.0-beta.2", false, &["latest.json"]),
            release("v0.10.0-beta.10", false, &["latest.json"]),
            release("v0.11.0-beta.1", true, &["latest.json"]),
            release("v0.12.0", false, &["a.deb"]),
            release("not-a-version", false, &["latest.json"]),
        ];
        assert_eq!(
            newest_update_file(&releases).as_deref(),
            Some("https://example.org/v0.10.0-beta.10/latest.json"),
            "beta.10 is after beta.2; a draft and a release without latest.json do not count"
        );
        let with_release = [
            release("v0.10.0-beta.10", false, &["latest.json"]),
            release("v0.10.0", false, &["latest.json"]),
        ];
        assert_eq!(
            newest_update_file(&with_release).as_deref(),
            Some("https://example.org/v0.10.0/latest.json"),
            "the release comes after its betas"
        );
        assert_eq!(newest_update_file(&[]), None);
    }

    #[test]
    fn the_download_page_is_the_release_of_that_version() {
        assert_eq!(
            release_page("0.10.0-beta.1"),
            "https://github.com/Ariazonaa/ytmusic-desktop/releases/tag/v0.10.0-beta.1"
        );
    }
}

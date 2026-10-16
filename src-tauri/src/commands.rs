//! IPC commands. The YouTube Music page may only call the ones listed in
//! `capabilities/ytm.json`, so keep that surface small.

use crate::autostart;
use crate::discord::{self, ActivityRequest, Discord};
use crate::health::{Health, HealthStore};
use crate::notification::{self, Notification};
use crate::plugins::{self, ExternalPlugin};
use crate::settings::{Settings, SettingsStore};
use crate::shortcuts;
use crate::themes::{self, Kind, Theme};
use crate::tray;
use crate::update::{self, UpdateInfo};
use crate::window;
use base64::Engine;
use serde_json::Value;
use std::collections::BTreeMap;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn get_settings(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

/// Opens or focuses the settings window. A call shortly after the last one
/// does nothing, so that the page cannot keep taking the focus.
#[tauri::command]
pub fn open_settings(app: AppHandle, limit: State<'_, OpenLimit>) {
    if limit.allow() {
        window::open_settings_window(&app);
    }
}

/// When the page last opened something outside itself: the settings window or
/// a folder. Shared, so that alternating between them is no way around it.
#[derive(Default)]
pub struct OpenLimit(Mutex<Option<Instant>>);

const OPEN_INTERVAL: Duration = Duration::from_secs(1);

impl OpenLimit {
    /// Whether opening is allowed now; if so, counts it.
    fn allow(&self) -> bool {
        let mut last = self.0.lock().unwrap_or_else(|err| err.into_inner());
        if last.is_some_and(|at| at.elapsed() < OPEN_INTERVAL) {
            return false;
        }
        *last = Some(Instant::now());
        true
    }
}

/// Changes the given top-level settings and keeps the rest as they are now.
/// Resolves with all settings as saved. Settings window only.
#[tauri::command]
pub fn update_settings(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    changes: serde_json::Map<String, Value>,
) -> Result<Settings, String> {
    commit(&app, &store, |current| {
        crate::settings::merged(current, changes)
    })
}

/// Changes some of one plugin's settings; with `replace`, the plugin keeps
/// only `values`. Resolves with all settings as saved. For the page, whose
/// plugins save their own settings, and for the settings window.
#[tauri::command]
pub fn update_plugin_settings(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    plugin: String,
    values: BTreeMap<String, Value>,
    replace: bool,
) -> Result<Settings, String> {
    commit(&app, &store, |current| {
        Ok(crate::settings::with_plugin_settings(
            current, &plugin, values, replace,
        ))
    })
}

/// Validates, saves and applies new settings.
fn apply(app: &AppHandle, store: &SettingsStore, settings: Settings) -> Result<(), String> {
    commit(app, store, |_| Ok(settings)).map(|_| ())
}

/// Makes the change to the current settings, validates, saves and applies
/// the result. Reading and writing happen in one step, so two changes at the
/// same time cannot undo each other.
fn commit(
    app: &AppHandle,
    store: &SettingsStore,
    change: impl FnOnce(&Settings) -> Result<Settings, String>,
) -> Result<Settings, String> {
    let settings = store.edit(change, |current, next| {
        if next.shortcuts != current.shortcuts {
            if let Err(err) = shortcuts::apply(app, &next.shortcuts) {
                // Keep what worked before; the rejected settings are not saved.
                let _ = shortcuts::apply(app, &current.shortcuts);
                return Err(err);
            }
        }
        Ok(())
    })?;
    autostart::sync(app, settings.startup);
    tray::set_language(app, &settings.language);
    window::apply_settings(app, &settings);
    Ok(settings)
}

/// The plugins found in the user's plugins folder.
#[tauri::command]
pub fn list_external_plugins(app: AppHandle) -> Vec<ExternalPlugin> {
    plugins::dir(&app)
        .map(|dir| plugins::list(&dir))
        .unwrap_or_default()
}

/// Picks up new and edited external plugins without a restart. Settings window only.
#[tauri::command]
pub fn reload_plugins(app: AppHandle) {
    window::reload_plugins(&app);
}

/// Whether a setting was changed that the running app cannot apply. Settings window only.
#[tauri::command]
pub fn restart_required(app: AppHandle, store: State<'_, SettingsStore>) -> bool {
    window::hardware_acceleration_active(&app) != store.get().hardware_acceleration
}

/// Quits the app and starts it again. Settings window only.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.request_restart();
}

/// The files to share of one kind: themes or equalizer presets.
#[tauri::command]
pub fn list_shared(app: AppHandle, kind: Kind) -> Vec<Theme> {
    themes::dir(&app, kind)
        .map(|dir| themes::list(&dir))
        .unwrap_or_default()
}

/// Writes a file to share. Returns its file name without the extension.
#[tauri::command]
pub fn save_shared(
    app: AppHandle,
    kind: Kind,
    name: String,
    settings: BTreeMap<String, Value>,
) -> Result<String, String> {
    let dir = themes::dir(&app, kind).ok_or("no config directory")?;
    themes::save(&dir, &name, settings)
}

/// Shows the tray what is playing. An empty title means nothing is.
#[tauri::command]
pub fn set_now_playing(app: AppHandle, title: String, artist: String) {
    tray::set_now_playing(&app, &title, &artist);
}

/// Adds a line from the page to the log file. Lines are bounded and counted.
#[tauri::command]
pub fn log_error(message: String) {
    crate::log::page_error(&message);
}

/// At most one notification in this time: the page asks for them, and a
/// page that asks too often must not cover the screen with them.
const NOTIFY_INTERVAL: Duration = Duration::from_secs(3);
const MAX_NOTIFY_TITLE_CHARS: usize = 80;
const MAX_NOTIFY_BODY_CHARS: usize = 240;
/// A megabyte of picture is about 1.4 million characters of base64.
const MAX_NOTIFY_IMAGE_CHARS: usize = 1_400_000;

/// When the last notification was shown.
#[derive(Default)]
pub struct NotifyLimit(Mutex<Option<Instant>>);

/// Text for a notification: one line, of bounded length.
fn notification_text(text: &str, max_chars: usize) -> String {
    let spaced: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let line = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    line.chars().take(max_chars).collect()
}

/// Shows a notification of the operating system. Refused while another one
/// was shown a moment ago. `image` is a PNG or JPEG file in base64;
/// `click_id` comes back to the page when the notification is clicked.
#[tauri::command]
pub fn notify(
    app: AppHandle,
    limit: State<'_, NotifyLimit>,
    title: String,
    body: String,
    image: Option<String>,
    click_id: Option<u32>,
) -> Result<(), String> {
    let title = notification_text(&title, MAX_NOTIFY_TITLE_CHARS);
    if title.is_empty() {
        return Err("a notification needs a title".into());
    }
    let mut last = limit.0.lock().unwrap_or_else(|err| err.into_inner());
    if last.is_some_and(|at| at.elapsed() < NOTIFY_INTERVAL) {
        return Err("too many notifications, try again in a moment".into());
    }
    // A picture that is too long or not base64 is left out, not an error.
    let image = image
        .filter(|text| text.len() <= MAX_NOTIFY_IMAGE_CHARS)
        .and_then(|text| base64::engine::general_purpose::STANDARD.decode(text).ok());
    notification::show(
        &app,
        Notification {
            title,
            body: notification_text(&body, MAX_NOTIFY_BODY_CHARS),
            image,
            click_id,
        },
    )?;
    *last = Some(Instant::now());
    Ok(())
}

/// Takes the page's report of what does not work. It replaces the last one.
#[tauri::command]
pub fn report_health(store: State<'_, HealthStore>, health: Health) {
    store.set(health);
}

/// What currently does not work. Settings window only.
#[tauri::command]
pub fn get_health(store: State<'_, HealthStore>) -> Health {
    store.get()
}

/// Whether the app runs for the first time. Settings window only.
#[tauri::command]
pub fn is_first_run(store: State<'_, SettingsStore>) -> bool {
    store.is_first_run()
}

/// Asks for a zip file and installs the plugin in it. Resolves with the
/// plugin's name, or `None` if the dialog was cancelled. The plugin is not
/// switched on. Settings window only.
#[tauri::command]
pub async fn install_plugin(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<String>, String> {
    let chosen = app
        .dialog()
        .file()
        .add_filter("Zip", &["zip"])
        .set_parent(&window)
        .blocking_pick_file();
    let Some(path) = chosen.and_then(|file| file.into_path().ok()) else {
        return Ok(None);
    };
    let dir = plugins::dir(&app).ok_or("no config directory")?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let archive = std::fs::File::open(&path).map_err(|err| err.to_string())?;
    let name = crate::install::install(&dir, archive)?;
    window::reload_plugins(&app);
    Ok(Some(name))
}

/// Fetches the public list of plugins from others. Settings window only.
#[tauri::command]
pub async fn marketplace_list(
    store: State<'_, crate::marketplace::MarketStore>,
) -> Result<Vec<crate::marketplace::Entry>, String> {
    let entries = crate::marketplace::fetch_list().await?;
    store.set(entries.clone());
    Ok(entries)
}

/// Downloads and installs a plugin from the list fetched last, by its name.
/// It is not switched on. Settings window only.
#[tauri::command]
pub async fn marketplace_install(
    app: AppHandle,
    store: State<'_, crate::marketplace::MarketStore>,
    name: String,
) -> Result<String, String> {
    let entry = store.find(&name).ok_or("the plugin is not in the list")?;
    let bytes = crate::marketplace::fetch_plugin(&entry).await?;
    let dir = plugins::dir(&app).ok_or("no config directory")?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let installed = crate::marketplace::install(&dir, &entry, &bytes)?;
    window::reload_plugins(&app);
    Ok(installed)
}

/// Opens the homepage of a plugin from the list fetched last in the browser.
/// Settings window only.
#[tauri::command]
pub fn marketplace_open_homepage(
    app: AppHandle,
    store: State<'_, crate::marketplace::MarketStore>,
    name: String,
) -> Result<(), String> {
    let homepage = store
        .find(&name)
        .and_then(|entry| entry.homepage)
        .ok_or("the plugin has no homepage in the list")?;
    app.opener()
        .open_url(homepage, None::<&str>)
        .map_err(|err| err.to_string())
}

/// Deletes an external plugin and switches it off. Settings window only.
#[tauri::command]
pub fn remove_plugin(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    name: String,
) -> Result<Settings, String> {
    let dir = plugins::dir(&app).ok_or("no config directory")?;
    crate::install::remove(&dir, &name)?;
    // Its settings stay, in case it is installed again.
    let mut settings = store.get();
    settings.plugins.retain(|plugin| plugin != &name);
    apply(&app, &store, settings.clone())?;
    window::reload_plugins(&app);
    Ok(settings)
}

/// The name of the device sound currently goes to, or `None` if it is not known.
#[tauri::command]
pub fn output_device() -> Option<String> {
    crate::audio_device::default_output_name()
}

/// The version of the running app. Settings window only.
#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// The update the last check found, if any. Settings window only.
#[tauri::command]
pub fn pending_update(app: AppHandle) -> Option<UpdateInfo> {
    update::pending(&app)
}

/// Asks the project's releases for a newer version. Settings window only.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    update::check(&app).await
}

/// Installs the update the last check found and starts the new version.
/// Settings window only.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    update::install(&app).await
}

/// Opens the log file. Settings window only.
#[tauri::command]
pub fn open_log(app: AppHandle) -> Result<(), String> {
    let path = crate::log::path().ok_or("no log file")?;
    if !path.exists() {
        std::fs::write(&path, "").map_err(|err| err.to_string())?;
    }
    // Notepad is always there. The program registered for text files may not
    // be, and Windows then asks which program to use instead of opening it.
    let with = cfg!(windows).then_some("notepad");
    app.opener()
        .open_path(path.to_string_lossy(), with)
        .map_err(|err| err.to_string())
}

/// A dialog for a settings file. It belongs to the window that asked, which
/// cannot be used until the dialog is closed, and starts in the documents folder.
fn file_dialog(app: &AppHandle, window: &WebviewWindow) -> FileDialogBuilder<tauri::Wry> {
    let dialog = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_parent(window);
    match app.path().document_dir() {
        Ok(dir) => dialog.set_directory(dir),
        Err(_) => dialog,
    }
}

/// Asks where to and writes the settings there. Resolves with whether a file
/// was written; `false` means the dialog was cancelled. Settings window only.
#[tauri::command]
pub async fn export_settings(app: AppHandle, window: WebviewWindow) -> Result<bool, String> {
    let chosen = file_dialog(&app, &window)
        .set_file_name("ytmusic-settings.json")
        .blocking_save_file();
    let Some(path) = chosen.and_then(|file| file.into_path().ok()) else {
        return Ok(false);
    };
    let settings = app.state::<SettingsStore>().get();
    let text = serde_json::to_string_pretty(&settings).map_err(|err| err.to_string())?;
    std::fs::write(path, text).map_err(|err| err.to_string())?;
    Ok(true)
}

/// Asks for a settings file and applies it. Resolves with the new settings,
/// or `None` if the dialog was cancelled. Settings window only.
#[tauri::command]
pub async fn import_settings(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<Settings>, String> {
    let chosen = file_dialog(&app, &window).blocking_pick_file();
    let Some(path) = chosen.and_then(|file| file.into_path().ok()) else {
        return Ok(None);
    };
    let settings = crate::settings::import(&path)?;
    apply(&app, &app.state::<SettingsStore>(), settings.clone())?;
    Ok(Some(settings))
}

/// Shows the folder for files to share of one kind in the file manager.
#[tauri::command]
pub fn open_shared_folder(
    app: AppHandle,
    limit: State<'_, OpenLimit>,
    kind: Kind,
) -> Result<(), String> {
    if !limit.allow() {
        return Err("opened a moment ago, try again".into());
    }
    let dir = themes::dir(&app, kind).ok_or("no config directory")?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|err| err.to_string())
}

/// Shows the plugins folder in the file manager. Settings window only.
#[tauri::command]
pub fn open_plugins_folder(app: AppHandle) -> Result<(), String> {
    let dir = plugins::dir(&app).ok_or("no config directory")?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|err| err.to_string())
}

/// Shows in Discord what is playing. Checked in `discord::check`. Page only.
#[tauri::command]
pub fn discord_set_activity(presence: State<'_, Discord>, activity: ActivityRequest) {
    presence.set(Some(discord::check(&activity, discord::now_ms())));
}

/// Takes the status out of Discord. Page only.
#[tauri::command]
pub fn discord_clear_activity(presence: State<'_, Discord>) {
    presence.set(None);
}

/// What Discord was last asked to show, for the preview. With `sample` and
/// nothing shown, the sample as Discord would get it. Settings window only.
#[tauri::command]
pub fn discord_preview(
    presence: State<'_, Discord>,
    sample: Option<ActivityRequest>,
) -> Option<discord::Activity> {
    presence
        .last()
        .or_else(|| sample.map(|request| discord::check(&request, discord::now_ms())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opening_again_at_once_is_refused() {
        let limit = OpenLimit::default();
        assert!(limit.allow());
        assert!(!limit.allow());
        *limit.0.lock().unwrap() = Some(Instant::now() - OPEN_INTERVAL);
        assert!(limit.allow());
    }
}

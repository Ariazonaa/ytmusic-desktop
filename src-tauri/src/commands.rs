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
        .map(|dir| plugins::list(&dir, app.state::<crate::frames::FrameGuard>().active()))
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

/// Asks where to and saves the cover at `url`, from YouTube's image servers,
/// as a picture named after `name`. Resolves with whether it was saved. A
/// call shortly after the last one is refused, so that the page cannot open
/// dialog after dialog.
#[tauri::command]
pub async fn save_cover(
    app: AppHandle,
    window: WebviewWindow,
    limit: State<'_, OpenLimit>,
    url: String,
    name: String,
) -> Result<bool, String> {
    if !crate::cover::is_cover_url(&url) {
        return Err("not a cover from YouTube's image servers".into());
    }
    if !limit.allow() {
        return Err("opened a moment ago, try again".into());
    }
    let bytes = crate::download::fetch(&url, crate::cover::MAX_COVER_BYTES).await?;
    let extension = crate::cover::image_extension(&bytes).ok_or("the cover is not a picture")?;
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Picture", &[extension])
        .set_parent(&window)
        .set_file_name(crate::cover::file_name(&name, extension));
    if let Ok(dir) = app.path().picture_dir() {
        dialog = dialog.set_directory(dir);
    }
    let Some(path) = dialog
        .blocking_save_file()
        .and_then(|file| file.into_path().ok())
    else {
        return Ok(false);
    };
    std::fs::write(path, bytes).map_err(|err| err.to_string())?;
    Ok(true)
}

/// "Now playing" for streaming software: writes the playing track to the
/// files in the now-playing folder and fetches its cover for them.
#[tauri::command]
pub async fn now_playing_update(
    app: AppHandle,
    state: State<'_, crate::now_playing::NowPlaying>,
    text: String,
    track: crate::now_playing::Track,
    cover_url: Option<String>,
) -> Result<(), String> {
    let dir = crate::now_playing::dir(&app).ok_or("no config directory")?;
    let cover_url = cover_url.filter(|url| crate::cover::is_cover_url(url));
    if state.update(&dir, &text, track, cover_url.clone())? {
        if let Some(url) = cover_url {
            let bytes = crate::download::fetch(&url, crate::cover::MAX_COVER_BYTES).await?;
            if crate::cover::image_extension(&bytes).is_some() {
                state.set_cover(&dir, &url, bytes)?;
            }
        }
    }
    Ok(())
}

/// Serves the now-playing page on 127.0.0.1 at `port`, or stops with `None`.
#[tauri::command]
pub fn now_playing_serve(
    state: State<'_, crate::now_playing::NowPlaying>,
    port: Option<u16>,
) -> Result<(), String> {
    state.serve(port)
}

/// Shows the now-playing folder in the file manager.
#[tauri::command]
pub fn open_now_playing_folder(app: AppHandle, limit: State<'_, OpenLimit>) -> Result<(), String> {
    if !limit.allow() {
        return Err("opened a moment ago, try again".into());
    }
    let dir = crate::now_playing::dir(&app).ok_or("no config directory")?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|err| err.to_string())
}

/// Adds what was heard of a track to the listening statistics.
#[tauri::command]
pub fn stats_record(
    app: AppHandle,
    store: State<'_, crate::stats::StatsStore>,
    heard: crate::stats::Heard,
) -> Result<(), String> {
    let path = crate::stats::path(&app).ok_or("no config directory")?;
    store.with(&path, |stats| stats.add(&heard))
}

/// The most heard tracks and artists, and the listening time of the last `days` days.
#[tauri::command]
pub fn stats_summary(
    app: AppHandle,
    store: State<'_, crate::stats::StatsStore>,
    days: usize,
) -> Result<crate::stats::Summary, String> {
    let path = crate::stats::path(&app).ok_or("no config directory")?;
    store.with(&path, |stats| Ok(stats.summary(days.min(366))))
}

/// Forgets all listening statistics.
#[tauri::command]
pub fn stats_clear(
    app: AppHandle,
    store: State<'_, crate::stats::StatsStore>,
) -> Result<(), String> {
    let path = crate::stats::path(&app).ok_or("no config directory")?;
    store.with(&path, |stats| {
        *stats = crate::stats::Stats::default();
        Ok(())
    })
}

/// Asks where to and saves `text` as a text or CSV file named after `name`.
/// Resolves with whether it was saved. A call shortly after the last one is
/// refused, so that the page cannot open dialog after dialog.
#[tauri::command]
pub async fn save_text(
    app: AppHandle,
    window: WebviewWindow,
    limit: State<'_, OpenLimit>,
    name: String,
    kind: String,
    text: String,
) -> Result<bool, String> {
    const MAX_TEXT_BYTES: usize = 5 * 1024 * 1024;
    let (filter, extension) = match kind.as_str() {
        "txt" => ("Text", "txt"),
        "csv" => ("CSV", "csv"),
        _ => return Err("the kind must be txt or csv".into()),
    };
    if text.len() > MAX_TEXT_BYTES {
        return Err("the text is too long".into());
    }
    if !limit.allow() {
        return Err("opened a moment ago, try again".into());
    }
    let mut dialog = app
        .dialog()
        .file()
        .add_filter(filter, &[extension])
        .set_parent(&window)
        .set_file_name(crate::cover::file_name(&name, extension));
    if let Ok(dir) = app.path().document_dir() {
        dialog = dialog.set_directory(dir);
    }
    let Some(path) = dialog
        .blocking_save_file()
        .and_then(|file| file.into_path().ok())
    else {
        return Ok(false);
    };
    std::fs::write(path, text).map_err(|err| err.to_string())?;
    Ok(true)
}

/// Shows or closes the lyrics window over other programs.
#[tauri::command]
pub fn lyrics_overlay(app: AppHandle, show: bool) {
    window::show_lyrics_overlay(&app, show);
}

/// Hands the line being sung and the next one to the lyrics window.
#[tauri::command]
pub fn lyrics_overlay_line(app: AppHandle, line: String, next: String) -> Result<(), String> {
    use tauri::Emitter;
    const MAX_CHARS: usize = 300;
    let cut = |text: String| text.chars().take(MAX_CHARS).collect::<String>();
    if app
        .get_webview_window(window::OVERLAY_WINDOW_LABEL)
        .is_none()
    {
        return Ok(());
    }
    app.emit_to(
        window::OVERLAY_WINDOW_LABEL,
        "lyrics-line",
        serde_json::json!({ "line": cut(line), "next": cut(next) }),
    )
    .map_err(|err| err.to_string())
}

/// Opens an HTTPS address in the user's browser, for a plugin's sign-in
/// page. Which hosts a plugin may open is checked in the page, as for its
/// requests. A call shortly after the last one is refused.
#[tauri::command]
pub fn open_link(app: AppHandle, limit: State<'_, OpenLimit>, url: String) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|_| "not an address".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() {
        return Err("only https addresses open".into());
    }
    if !limit.allow() {
        return Err("opened a moment ago, try again".into());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|err| err.to_string())
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

/// Asks a security key to sign in, for the Google sign-in, which WebKitGTK
/// leaves without Web Authentication. Errors start with the name of the
/// `DOMException` the page gets. Sign-in page only, Linux only.
#[tauri::command]
pub async fn webauthn_get(
    app: AppHandle,
    webview: tauri::Webview,
    request: crate::webauthn::GetRequest,
) -> Result<crate::webauthn::Assertion, String> {
    #[cfg(target_os = "linux")]
    {
        // The page the window shows, not one the script claims.
        let page = webview.url().map_err(|err| err.to_string())?;
        // Waits for a touch of the key, which can take a while.
        tauri::async_runtime::spawn_blocking(move || {
            crate::webauthn::get(&app.state::<crate::webauthn::WebAuthn>(), &page, request)
        })
        .await
        .map_err(|err| err.to_string())?
        .map_err(|failure| failure.to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, webview, request);
        Err("NotSupportedError: the browser has its own".into())
    }
}

/// Cancels the request of `webauthn_get`, as the page's `AbortSignal` asks.
#[tauri::command]
pub fn webauthn_cancel(app: AppHandle) {
    #[cfg(target_os = "linux")]
    crate::webauthn::cancel(&app.state::<crate::webauthn::WebAuthn>());
    #[cfg(not(target_os = "linux"))]
    let _ = app;
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

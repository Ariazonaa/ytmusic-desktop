use crate::background;
use crate::settings::{Settings, SettingsStore};
use std::sync::OnceLock;
use tauri::{
    webview::NewWindowResponse, AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

pub const MAIN_WINDOW_LABEL: &str = "main";
const SETTINGS_WINDOW_LABEL: &str = "settings";
const YTM_URL: &str = "https://music.youtube.com";
// Development builds on Windows load the script from disk instead, see `dev_inject`.
#[cfg(not(all(debug_assertions, windows)))]
const INJECT_SCRIPT: &str = include_str!("../../dist-inject/inject.js");

/// Whether the running browser draws on the GPU. This can differ from the
/// setting, which only applies from the next start.
pub fn hardware_acceleration_active(app: &AppHandle) -> bool {
    !browser_args(app).contains("--disable-gpu")
}

/// The arguments WebView2 is started with.
///
/// All windows share one browser, which refuses a window whose arguments
/// differ from the ones it was started with. So they are fixed on first use,
/// and a changed setting applies from the next start.
fn browser_args(app: &AppHandle) -> &'static str {
    static ARGS: OnceLock<String> = OnceLock::new();
    ARGS.get_or_init(|| {
        // Setting any arguments replaces Tauri's defaults, so they are repeated here.
        let mut args =
            String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection");
        if !app.state::<SettingsStore>().get().hardware_acceleration {
            args.push_str(" --disable-gpu");
        }
        args
    })
}

/// `hidden` starts the app in the tray: the page loads, but no window shows.
pub fn create_main_window(app: &AppHandle, hidden: bool) -> tauri::Result<()> {
    // In development the window starts empty: `dev_inject` registers the
    // script first and then opens the page.
    let start_url = if cfg!(all(debug_assertions, windows)) {
        "about:blank"
    } else {
        YTM_URL
    };
    let url = start_url.parse().expect("the start URL is valid");
    let nav_app = app.clone();
    let popup_app = app.clone();
    let builder = WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::External(url))
        .title("YouTube Music")
        .visible(!hidden)
        .additional_browser_args(browser_args(app))
        .inner_size(1280.0, 800.0)
        .min_inner_size(480.0, 360.0)
        .on_navigation(move |url| match classify(url) {
            Navigation::Allow => true,
            Navigation::Block => false,
            Navigation::OpenExternally => {
                open_in_browser(&nav_app, url);
                false
            }
        })
        .on_new_window(move |url, _features| {
            // The app is a single window: links that want a new one go to the browser.
            if classify(&url) != Navigation::Block {
                open_in_browser(&popup_app, &url);
            }
            NewWindowResponse::Deny
        });

    #[cfg(not(all(debug_assertions, windows)))]
    let window = builder.initialization_script(INJECT_SCRIPT).build()?;
    #[cfg(all(debug_assertions, windows))]
    let window = builder.build()?;
    #[cfg(all(debug_assertions, windows))]
    crate::dev_inject::start(&window, YTM_URL);
    // Without a connection, the app shows a page of its own instead of the browser's error page.
    let language_app = app.clone();
    crate::offline::watch(&window, YTM_URL, move || {
        language_app.state::<SettingsStore>().get().language
    });
    if hidden {
        background::set_hidden(&window, true);
    }
    Ok(())
}

/// Brings the main window back from the tray or from behind other windows.
pub fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    background::set_hidden(&window, false);
    let result = window
        .unminimize()
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(err) = result {
        log_error!("cannot show the main window: {err}");
    }
}

/// Hides the main window to the tray. Playback continues.
pub fn hide_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    if let Err(err) = window.hide() {
        log_error!("cannot hide the main window: {err}");
        return;
    }
    background::set_hidden(&window, true);
}

/// Opens the settings window, or focuses it if it is already open.
pub fn open_settings_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        if let Err(err) = window.unminimize().and_then(|()| window.set_focus()) {
            log_error!("cannot focus the settings window: {err}");
        }
        return;
    }
    // On Windows, building a window inside a command or event handler
    // deadlocks the event loop, so it happens on its own thread.
    let app = app.clone();
    std::thread::spawn(move || {
        let url = WebviewUrl::App("index.html".into());
        let result = WebviewWindowBuilder::new(&app, SETTINGS_WINDOW_LABEL, url)
            .title("Settings")
            .additional_browser_args(browser_args(&app))
            .inner_size(520.0, 560.0)
            .min_inner_size(360.0, 320.0)
            .build();
        if let Err(err) = result {
            log_error!("cannot open the settings window: {err}");
        }
    });
}

/// Tells the injected script about changed settings so that plugins are
/// switched on and off without a restart.
pub fn apply_settings(app: &AppHandle, settings: &Settings) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    // JSON is valid JavaScript, so the settings can be passed as a literal.
    let result = serde_json::to_string(settings)
        .map_err(tauri::Error::from)
        .and_then(|json| window.eval(format!("window.__ytmDesktop?.applySettings?.({json})")));
    if let Err(err) = result {
        log_error!("cannot apply settings to the page: {err}");
    }
}

/// Makes the injected script read the plugins folder again and restart the
/// external plugins, so that new and edited plugins take effect.
pub fn reload_plugins(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    if let Err(err) = window.eval("window.__ytmDesktop?.reloadPlugins?.()") {
        log_error!("cannot reload plugins: {err}");
    }
}

/// Tells the page that a newer version of the app can be installed.
pub fn update_available(app: &AppHandle, version: &str) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    // The version comes from the network: as JSON it is a harmless literal.
    let result = serde_json::to_string(version)
        .map_err(tauri::Error::from)
        .and_then(|json| window.eval(format!("window.__ytmDesktop?.updateAvailable?.({json})")));
    if let Err(err) = result {
        log_error!("cannot tell the page about the update: {err}");
    }
}

/// Tells the page that the notification it asked for under `id` was clicked.
pub fn notification_clicked(app: &AppHandle, id: u32) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    if let Err(err) = window.eval(format!("window.__ytmDesktop?.notificationClicked?.({id})")) {
        log_error!("cannot report the click on a notification: {err}");
    }
}

#[derive(Debug, Clone, Copy)]
pub enum PlayerAction {
    PlayPause,
    Next,
    Previous,
    VolumeUp,
    VolumeDown,
    ToggleMute,
}

impl PlayerAction {
    /// The name the injected script knows the action by (`src/core/player/controls.ts`).
    fn as_str(self) -> &'static str {
        match self {
            Self::PlayPause => "playPause",
            Self::Next => "next",
            Self::Previous => "previous",
            Self::VolumeUp => "volumeUp",
            Self::VolumeDown => "volumeDown",
            Self::ToggleMute => "toggleMute",
        }
    }
}

/// Controls the player through the hook the injected script installs.
pub fn control_player(app: &AppHandle, action: PlayerAction) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let script = format!("window.__ytmDesktop?.control('{}')", action.as_str());
    if let Err(err) = window.eval(script) {
        log_error!("cannot control the player: {err}");
    }
}

fn open_in_browser(app: &AppHandle, url: &Url) {
    if let Err(err) = app.opener().open_url(url.as_str(), None::<&str>) {
        log_error!("cannot open {url} in the browser: {err}");
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Navigation {
    Allow,
    OpenExternally,
    Block,
}

/// Decides what the main window does with a navigation: YouTube and the Google
/// sign-in flow stay in the app, other web pages go to the default browser.
fn classify(url: &Url) -> Navigation {
    match url.scheme() {
        "https" | "http" => match url.host_str() {
            Some(host) if is_in_app_host(host) => Navigation::Allow,
            Some(_) => Navigation::OpenExternally,
            None => Navigation::Block,
        },
        "about" | "blob" | "data" => Navigation::Allow,
        _ => Navigation::Block,
    }
}

fn is_in_app_host(host: &str) -> bool {
    const GOOGLE_HOSTS: [&str; 2] = ["consent.google.com", "gds.google.com"];
    host == "youtube.com"
        || host.ends_with(".youtube.com")
        || GOOGLE_HOSTS.contains(&host)
        || host
            .strip_prefix("accounts.google.")
            .is_some_and(is_country_suffix)
}

/// Sign-in bounces through country domains such as `accounts.google.de` or
/// `accounts.google.co.uk`. Accept those, but not `accounts.google.evil.com`.
fn is_country_suffix(suffix: &str) -> bool {
    let labels: Vec<&str> = suffix.split('.').collect();
    let is_short_alpha = |label: &&str| {
        (2..=3).contains(&label.len()) && label.bytes().all(|b| b.is_ascii_lowercase())
    };
    match labels.as_slice() {
        [tld] => is_short_alpha(tld),
        [second, tld] => is_short_alpha(second) && tld.len() == 2 && is_short_alpha(tld),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify_str(url: &str) -> Navigation {
        classify(&url.parse().unwrap())
    }

    #[test]
    fn youtube_and_sign_in_stay_in_app() {
        for url in [
            "https://music.youtube.com/watch?v=abc",
            "https://www.youtube.com/signin",
            "https://accounts.youtube.com/accounts/SetSID",
            "https://consent.youtube.com/m",
            "https://accounts.google.com/ServiceLogin",
            "https://accounts.google.de/accounts/SetSID",
            "https://accounts.google.co.uk/accounts/SetSID",
            "https://consent.google.com/ml",
            "about:blank",
        ] {
            assert_eq!(classify_str(url), Navigation::Allow, "{url}");
        }
    }

    #[test]
    fn other_sites_open_in_the_browser() {
        for url in [
            "https://example.com/",
            "https://support.google.com/youtubemusic",
            "https://notyoutube.com/",
            "https://youtube.com.evil.example/",
            "https://accounts.google.evil.com/",
            "https://accounts.google.com.evil.example/",
        ] {
            assert_eq!(classify_str(url), Navigation::OpenExternally, "{url}");
        }
    }

    #[test]
    fn unknown_schemes_are_blocked() {
        assert_eq!(
            classify_str("file:///C:/Windows/win.ini"),
            Navigation::Block
        );
        assert_eq!(classify_str("ms-settings:privacy"), Navigation::Block);
    }
}

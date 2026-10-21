//! Notifications of the operating system, with a picture and a reaction to
//! being clicked where the system offers that.
//!
//! The picture arrives as bytes from the YouTube Music page. It is only
//! written to disk, for the system to show, if it starts like a PNG or JPEG
//! file and is small.

use crate::window;
#[cfg(any(windows, test))]
use std::path::Path;
use std::{
    fs,
    hash::{BuildHasher, RandomState},
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        OnceLock,
    },
};
use tauri::AppHandle;

const MAX_IMAGE_BYTES: usize = 1024 * 1024;
/// Pictures are written to this many files in turn, so they do not pile up.
const IMAGE_FILES: usize = 4;

pub struct Notification {
    pub title: String,
    pub body: String,
    /// A PNG or JPEG file's contents.
    pub image: Option<Vec<u8>>,
    /// Passed back to the page when the notification is clicked.
    pub click_id: Option<u32>,
}

/// The file extension for picture data, if it is a kind that is shown.
fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() > MAX_IMAGE_BYTES {
        None
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else {
        None
    }
}

/// Writes the picture where the system can read it. `None` if it is not a
/// picture that is shown; the notification then goes out without one.
fn save_image(bytes: &[u8]) -> Option<PathBuf> {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let extension = image_extension(bytes)?;
    let slot = NEXT.fetch_add(1, Ordering::Relaxed) % IMAGE_FILES;
    let path = std::env::temp_dir().join(format!("ytmd-notification-{slot}.{extension}"));
    fs::write(&path, bytes).ok()?;
    Some(path)
}

/// What a click on a notification opens on Windows, see `show`:
/// `ytmusic://notification-clicked?id=…&key=…`.
const CLICK_LINK: &str = "notification-clicked";

/// A number only this run knows, carried by its click links: a link from
/// elsewhere can bring the window back, but not report a click to the page.
fn link_key() -> &'static str {
    static KEY: OnceLock<String> = OnceLock::new();
    // `RandomState` takes its keys from the system's random numbers.
    KEY.get_or_init(|| format!("{:016x}", RandomState::new().hash_one(std::process::id())))
}

/// The link for a click on a notification. Only with an id and the key does
/// the page learn of the click.
#[cfg(any(windows, test))]
fn click_link(click_id: Option<u32>, key: &str) -> String {
    let link = format!("{}://{CLICK_LINK}", window::LINK_SCHEME);
    match click_id {
        Some(id) => format!("{link}?id={id}&key={key}"),
        None => link,
    }
}

/// `None` if `arg` is no click link; otherwise the click's id, if the link
/// has one and `key`.
fn click_from_link(arg: &str, key: &str) -> Option<Option<u32>> {
    let (scheme, rest) = arg.split_once("://")?;
    if !scheme.eq_ignore_ascii_case(window::LINK_SCHEME) {
        return None;
    }
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    if path.trim_matches('/') != CLICK_LINK {
        return None;
    }
    let param = |name: &str| {
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix(name)?.strip_prefix('='))
    };
    let id = param("id").and_then(|id| id.parse().ok());
    Some(id.filter(|_| param("key") == Some(key)))
}

/// The click among the arguments of another start, if Windows started the
/// app for a click on a notification: `Some(None)` is a click without an id.
pub fn clicked_link(args: &[String]) -> Option<Option<u32>> {
    args.iter().find_map(|arg| click_from_link(arg, link_key()))
}

/// Whether `arg` is the link of a click on a notification, which stands for
/// no page.
pub fn is_click_link(arg: &str) -> bool {
    click_from_link(arg, "").is_some()
}

/// The notification for Windows: the title, a second line, the picture in
/// place of the app's icon, and the link a click opens.
#[cfg(any(windows, test))]
fn toast_xml(title: &str, body: &str, image: Option<&Path>, launch: Option<&str>) -> String {
    let mut xml = String::from("<toast");
    if let Some(link) = launch {
        xml += &format!(r#" activationType="protocol" launch="{}""#, xml_text(link));
    }
    xml += r#"><visual><binding template="ToastGeneric">"#;
    xml += &format!(
        "<text>{}</text><text>{}</text>",
        xml_text(title),
        xml_text(body)
    );
    if let Some(path) = image {
        let src = xml_text(&path.display().to_string());
        xml += &format!(r#"<image placement="appLogoOverride" src="file:///{src}" alt=""/>"#);
    }
    xml + "</binding></visual></toast>"
}

/// Text for XML, in an element or an attribute. Characters XML cannot hold
/// are left out.
#[cfg(any(windows, test))]
fn xml_text(text: &str) -> String {
    let mut xml = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => xml.push_str("&amp;"),
            '<' => xml.push_str("&lt;"),
            '>' => xml.push_str("&gt;"),
            '"' => xml.push_str("&quot;"),
            '\'' => xml.push_str("&apos;"),
            '\t' | '\n' | '\r' => xml.push(c),
            '\u{0}'..='\u{1F}' | '\u{FFFE}' | '\u{FFFF}' => {}
            c => xml.push(c),
        }
    }
    xml
}

/// Whether a command line from the registry starts `program`: its first
/// part, in quotes or up to the first space, is that file.
#[cfg(any(windows, test))]
fn command_runs(command: &str, program: &Path) -> bool {
    let first = match command.strip_prefix('"') {
        Some(quoted) => quoted.split('"').next(),
        None => command.split(' ').next(),
    };
    first.is_some_and(|first| {
        !first.is_empty() && first.to_lowercase() == program.to_string_lossy().to_lowercase()
    })
}

/// Clicking a notification brings the window back and tells the page.
pub fn clicked(app: &AppHandle, click_id: Option<u32>) {
    window::show_main_window(app);
    if let Some(id) = click_id {
        window::notification_clicked(app, id);
    }
}

/// PowerShell's name, under which a build Windows does not know shows its
/// notifications.
#[cfg(windows)]
const POWERSHELL_APP_ID: &str =
    r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";

#[cfg(windows)]
pub fn show(app: &AppHandle, notification: Notification) -> Result<(), String> {
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        Foundation::TypedEventHandler,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
    };

    let program = std::env::current_exe().ok();
    // Windows only shows notifications of programs it knows. The installer
    // registers the app under its identifier; a build run from the build
    // folder is not registered and borrows PowerShell's name.
    let installed = program.as_deref().is_some_and(|exe| {
        let dir = exe.parent().map(|dir| dir.to_string_lossy().into_owned());
        !dir.is_some_and(|dir| {
            dir.ends_with("\\target\\debug") || dir.ends_with("\\target\\release")
        })
    });
    let app_id = if installed {
        app.config().identifier.as_str()
    } else {
        POWERSHELL_APP_ID
    };
    // A click in the notification centre reaches the app only as a link that
    // Windows opens, which starts the app again and so gets to the running
    // one. Only where the link starts this very program: elsewhere Windows
    // would ask which app should open it, or start another one.
    let launch = program
        .as_deref()
        .is_some_and(link_starts)
        .then(|| click_link(notification.click_id, link_key()));
    let image = notification.image.as_deref().and_then(save_image);
    let xml = toast_xml(
        &notification.title,
        &notification.body,
        image.as_deref(),
        launch.as_deref(),
    );
    let handle = app.clone();
    let click_id = notification.click_id;
    let send = || -> windows::core::Result<()> {
        let doc = XmlDocument::new()?;
        doc.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&doc)?;
        // While the banner shows, a click also comes here. Twice does no
        // harm: the page runs a click's handler once.
        toast.Activated(&TypedEventHandler::new(move |_, _| {
            clicked(&handle, click_id);
            Ok(())
        }))?;
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)
    };
    send().map_err(|err| err.to_string())
}

/// Whether the app's link scheme starts this program, as the installer sets
/// it up.
#[cfg(windows)]
fn link_starts(program: &Path) -> bool {
    windows_registry::CLASSES_ROOT
        .open(format!(r"{}\shell\open\command", window::LINK_SCHEME))
        .and_then(|key| key.get_string(""))
        .is_ok_and(|command| command_runs(&command, program))
}

/// Elsewhere the notification is shown plainly: no picture, no click. Sent
/// over D-Bus in a thread of its own, which can wait a while when no
/// notification service answers.
#[cfg(not(windows))]
pub fn show(app: &AppHandle, notification: Notification) -> Result<(), String> {
    let Notification {
        title,
        body,
        image,
        click_id,
    } = notification;
    // Named here so that they do not count as unused on these systems.
    let _ = (app, save_image, image, click_id);
    std::thread::spawn(move || {
        let shown = notify_rust::Notification::new()
            .summary(&title)
            .body(&body)
            .auto_icon()
            .show();
        // Once per start: without a notification service each one fails.
        static REPORTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if let Err(err) = shown {
            if !REPORTED.swap(true, Ordering::Relaxed) {
                log_error!("cannot show notifications: {err}");
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

    #[test]
    fn recognizes_png_and_jpeg() {
        assert_eq!(image_extension(&PNG), Some("png"));
        assert_eq!(
            image_extension(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]),
            Some("jpg")
        );
    }

    #[test]
    fn refuses_other_data_and_large_pictures() {
        assert_eq!(image_extension(b"<svg onload=alert(1)>"), None);
        assert_eq!(image_extension(b"MZ\x90\x00"), None);
        assert_eq!(image_extension(b"GIF89a"), None);
        assert_eq!(image_extension(&[]), None);
        let mut large = PNG.to_vec();
        large.resize(MAX_IMAGE_BYTES + 1, 0);
        assert_eq!(image_extension(&large), None);
    }

    #[test]
    fn a_click_link_carries_the_id_and_the_key() {
        assert_eq!(
            click_link(Some(7), "k1"),
            "ytmusic://notification-clicked?id=7&key=k1"
        );
        assert_eq!(click_link(None, "k1"), "ytmusic://notification-clicked");
    }

    #[test]
    fn a_click_link_gives_its_id_back_with_the_right_key() {
        assert_eq!(
            click_from_link(&click_link(Some(7), "k1"), "k1"),
            Some(Some(7))
        );
        assert_eq!(click_from_link(&click_link(None, "k1"), "k1"), Some(None));
        // The way some programs pass a link on.
        assert_eq!(
            click_from_link("YTMUSIC:///notification-clicked/?id=7&key=k1", "k1"),
            Some(Some(7))
        );
    }

    #[test]
    fn without_the_right_key_a_click_link_only_shows_the_window() {
        for link in [
            "ytmusic://notification-clicked?id=7&key=k2",
            "ytmusic://notification-clicked?id=7",
            "ytmusic://notification-clicked?id=7&key=",
            "ytmusic://notification-clicked?id=x&key=k1",
            "ytmusic://notification-clicked?id=4294967296&key=k1",
        ] {
            assert_eq!(click_from_link(link, "k1"), Some(None), "{link}");
        }
    }

    #[test]
    fn other_arguments_are_no_click_links() {
        for arg in [
            "ytmusic://watch?v=abc",
            "ytmusic://notification-clickedx",
            "ytmusic://watch/notification-clicked",
            "ytmusicx://notification-clicked",
            "https://music.youtube.com/notification-clicked?id=7&key=k1",
            "--next",
            "",
        ] {
            assert_eq!(click_from_link(arg, "k1"), None, "{arg}");
        }
    }

    #[test]
    fn the_key_stays_the_same_in_a_run() {
        let key = link_key();
        assert_eq!(key.len(), 16);
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()), "{key}");
        assert_eq!(link_key(), key);
    }

    #[test]
    fn the_toast_has_title_body_and_picture() {
        assert_eq!(
            toast_xml(
                "Song",
                "Artist – Album",
                Some(Path::new(r"C:\Temp\ytmd-notification-0.png")),
                None
            ),
            concat!(
                r#"<toast><visual><binding template="ToastGeneric">"#,
                "<text>Song</text><text>Artist – Album</text>",
                r#"<image placement="appLogoOverride" src="file:///C:\Temp\ytmd-notification-0.png" alt=""/>"#,
                "</binding></visual></toast>"
            )
        );
    }

    #[test]
    fn a_click_on_the_toast_opens_the_link() {
        let xml = toast_xml(
            "Song",
            "",
            None,
            Some("ytmusic://notification-clicked?id=7&key=k1"),
        );
        assert!(
            xml.starts_with(r#"<toast activationType="protocol" launch="ytmusic://notification-clicked?id=7&amp;key=k1">"#),
            "{xml}"
        );
    }

    #[test]
    fn text_in_the_toast_is_escaped() {
        let xml = toast_xml(r#"<b>"Tom" & 'Jerry'</b>"#, "a\u{FFFF}b\u{1}c", None, None);
        assert!(
            xml.contains("<text>&lt;b&gt;&quot;Tom&quot; &amp; &apos;Jerry&apos;&lt;/b&gt;</text>"),
            "{xml}"
        );
        // Characters XML cannot hold are left out.
        assert!(xml.contains("<text>abc</text>"), "{xml}");
    }

    #[cfg(windows)]
    #[test]
    fn windows_takes_the_toast() {
        use windows::{
            core::HSTRING, Data::Xml::Dom::XmlDocument, UI::Notifications::ToastNotification,
        };
        let xml = toast_xml(
            "Song <1> & more",
            "Artist – Album",
            Some(Path::new(r"C:\Temp\ytmd-notification-0.png")),
            Some(&click_link(Some(7), "k1")),
        );
        let doc = XmlDocument::new().unwrap();
        doc.LoadXml(&HSTRING::from(xml)).unwrap();
        ToastNotification::CreateToastNotification(&doc).unwrap();
    }

    #[test]
    fn a_registered_command_runs_only_its_own_program() {
        let program =
            Path::new(r"C:\Users\A B\AppData\Local\YouTube Music Desktop\ytmusic-desktop.exe");
        assert!(command_runs(
            r#""C:\Users\A B\AppData\Local\YouTube Music Desktop\ytmusic-desktop.exe" "%1""#,
            program
        ));
        assert!(command_runs(
            r#""c:\users\a b\appdata\local\youtube music desktop\YTMUSIC-DESKTOP.EXE" "%1""#,
            program
        ));
        assert!(command_runs(
            r#"C:\Apps\ytmusic-desktop.exe "%1""#,
            Path::new(r"C:\Apps\ytmusic-desktop.exe")
        ));
        for other in [
            r#""C:\Other\ytmusic-desktop.exe" "%1""#,
            r#""C:\Users\A B\AppData\Local\YouTube Music Desktop\ytmusic-desktop.exe.old" "%1""#,
            r#"C:\Users\A B\AppData\Local\YouTube Music Desktop\ytmusic-desktop.exe "%1""#,
            "",
        ] {
            assert!(!command_runs(other, program), "{other}");
        }
    }

    #[test]
    fn writes_pictures_to_a_few_files_in_turn() {
        let paths: Vec<PathBuf> = (0..IMAGE_FILES * 2)
            .map(|_| save_image(&PNG).unwrap())
            .collect();
        let mut distinct = paths.clone();
        distinct.sort();
        distinct.dedup();
        assert_eq!(distinct.len(), IMAGE_FILES);
        assert!(paths.iter().all(|path| path.extension().unwrap() == "png"));
        assert!(save_image(b"not a picture").is_none());
        for path in distinct {
            let _ = fs::remove_file(path);
        }
    }
}

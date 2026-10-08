//! Notifications of the operating system, with a picture and a reaction to
//! being clicked where the system offers that.
//!
//! The picture arrives as bytes from the YouTube Music page. It is only
//! written to disk, for the system to show, if it starts like a PNG or JPEG
//! file and is small.

use crate::window;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
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

/// Clicking a notification brings the window back and tells the page.
fn clicked(app: &AppHandle, click_id: Option<u32>) {
    window::show_main_window(app);
    if let Some(id) = click_id {
        window::notification_clicked(app, id);
    }
}

#[cfg(windows)]
pub fn show(app: &AppHandle, notification: Notification) -> Result<(), String> {
    use tauri_winrt_notification::{IconCrop, Toast};

    // Windows only shows notifications of programs it knows. The installer
    // registers the app under its identifier; a build run from the build
    // folder is not registered and borrows PowerShell's name.
    let installed = std::env::current_exe().ok().is_some_and(|exe| {
        let dir = exe.parent().map(|dir| dir.to_string_lossy().into_owned());
        !dir.is_some_and(|dir| {
            dir.ends_with("\\target\\debug") || dir.ends_with("\\target\\release")
        })
    });
    let app_id = if installed {
        app.config().identifier.as_str()
    } else {
        Toast::POWERSHELL_APP_ID
    };
    let mut toast = Toast::new(app_id)
        .title(&notification.title)
        .text1(&notification.body);
    if let Some(path) = notification.image.as_deref().and_then(save_image) {
        toast = toast.icon(&path, IconCrop::Square, "");
    }
    let handle = app.clone();
    let click_id = notification.click_id;
    toast
        .on_activated(move |_action| {
            clicked(&handle, click_id);
            Ok(())
        })
        .show()
        .map_err(|err| err.to_string())
}

/// Elsewhere the notification is shown plainly: no picture, no click.
#[cfg(not(windows))]
pub fn show(app: &AppHandle, notification: Notification) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    let Notification {
        title,
        body,
        image,
        click_id,
    } = notification;
    // Named here so that they do not count as unused on these systems.
    let _ = (save_image, clicked, image, click_id);
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|err| err.to_string())
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

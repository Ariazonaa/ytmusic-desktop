//! Saving the cover of the playing track as a picture. The page names the
//! picture; only YouTube's image servers are asked for it, and only a picture
//! is written.

/// Covers are larger than a few megabytes only by mistake.
pub const MAX_COVER_BYTES: usize = 10 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 120;

/// Whether `url` is a cover on YouTube's image servers, over HTTPS.
pub fn is_cover_url(url: &str) -> bool {
    let Ok(url) = url.parse::<tauri::Url>() else {
        return false;
    };
    let host = url.host_str().unwrap_or_default();
    url.scheme() == "https"
        && ["ytimg.com", "googleusercontent.com", "ggpht.com"]
            .iter()
            .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

/// The file extension for a picture, or `None` if the bytes are not one.
pub fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

/// A file name from `name` that every file system takes: no path, no
/// characters Windows refuses, not too long, never empty.
pub fn file_name(name: &str, extension: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let words = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let short: String = words.chars().take(MAX_NAME_CHARS).collect();
    // Windows does not allow a name to end in a dot or a space.
    let stem = short.trim_end_matches(['.', ' ']);
    let stem = if stem.is_empty() { "Cover" } else { stem };
    format!("{stem}.{extension}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_youtube_image_servers() {
        assert!(is_cover_url(
            "https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj"
        ));
        assert!(is_cover_url(
            "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"
        ));
        assert!(is_cover_url("https://yt3.ggpht.com/x"));
        for bad in [
            "http://i.ytimg.com/vi/x/hq.jpg",
            "https://ytimg.com.evil.example/x.jpg",
            "https://evilytimg.com/x.jpg",
            "file:///C:/Windows/win.ini",
            "not a url",
        ] {
            assert!(!is_cover_url(bad), "{bad}");
        }
    }

    #[test]
    fn knows_pictures_by_their_first_bytes() {
        assert_eq!(image_extension(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(image_extension(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(image_extension(b"<html>"), None);
    }

    #[test]
    fn names_files_safely() {
        assert_eq!(file_name("Maroon 5 - Sugar", "jpg"), "Maroon 5 - Sugar.jpg");
        assert_eq!(
            file_name("AC/DC: Back in Black?", "png"),
            "AC DC Back in Black.png"
        );
        assert_eq!(file_name("..\\..\\x", "jpg"), ".. .. x.jpg");
        assert_eq!(file_name("Ends with a dot.", "jpg"), "Ends with a dot.jpg");
        assert_eq!(file_name("  ", "jpg"), "Cover.jpg");
        assert_eq!(file_name(&"x".repeat(500), "jpg").len(), 124);
    }
}

//! Files to share: JSON files in `<config dir>/themes` and
//! `<config dir>/equalizer` that hold a name and some settings of a plugin, so
//! a look or an equalizer preset can be saved and passed on.
//!
//! The files come from other people, and the page may write them, so both
//! directions only let flat, bounded values through. What the settings mean
//! is checked by the frontend against the plugin's schema.

use crate::settings::{is_valid_setting_key, is_valid_setting_value};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, Runtime};

const MAX_FILE_BYTES: u64 = 64 * 1024;
const MAX_THEMES: usize = 100;
const MAX_NAME_CHARS: usize = 60;
const MAX_SETTINGS: usize = 64;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Theme {
    /// The file name without `.json`. Not part of the file's contents.
    #[serde(skip_deserializing)]
    pub file: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub settings: BTreeMap<String, Value>,
}

/// What kind of settings a file holds. Each kind has its own folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    /// Settings of the themes plugin.
    Themes,
    /// An equalizer preset: the gain of each band and the pre-amplifier.
    Equalizer,
}

impl Kind {
    fn folder(self) -> &'static str {
        match self {
            Self::Themes => "themes",
            Self::Equalizer => "equalizer",
        }
    }
}

/// The folder users put files of this kind into.
pub fn dir<R: Runtime>(app: &AppHandle<R>, kind: Kind) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join(kind.folder()))
}

/// Reads the theme files in `dir`, sorted by name. Unreadable files are skipped.
pub fn list(dir: &Path) -> Vec<Theme> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut themes: Vec<Theme> = entries
        .filter_map(|entry| read(&entry.ok()?.path()))
        .take(MAX_THEMES)
        .collect();
    themes.sort_by_key(|theme| theme.name.to_lowercase());
    themes
}

fn read(path: &Path) -> Option<Theme> {
    if path.extension()?.to_str()? != "json" {
        return None;
    }
    let file = path.file_stem()?.to_str()?.to_owned();
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return None;
    }
    let mut theme: Theme = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    theme.name = clean_name(&theme.name).unwrap_or_else(|| file.clone());
    theme
        .settings
        .retain(|key, value| is_valid_setting_key(key) && is_valid_setting_value(value));
    if theme.settings.len() > MAX_SETTINGS {
        return None;
    }
    theme.file = file;
    Some(theme)
}

/// Writes a theme file and returns its file name without `.json`. A theme of
/// the same name is replaced.
pub fn save(dir: &Path, name: &str, settings: BTreeMap<String, Value>) -> Result<String, String> {
    let name = clean_name(name).ok_or("enter a name")?;
    let file = slug(&name).ok_or("the name needs at least one letter or digit")?;
    if settings.len() > MAX_SETTINGS {
        return Err("too many settings".into());
    }
    if let Some(key) = settings.iter().find_map(|(key, value)| {
        (!is_valid_setting_key(key) || !is_valid_setting_value(value)).then_some(key)
    }) {
        return Err(format!("invalid setting: {key:?}"));
    }
    let theme = Theme {
        file: String::new(),
        name,
        settings,
    };
    // `file` is skipped when reading, so it is left out when writing as well.
    let contents = serde_json::json!({ "name": theme.name, "settings": theme.settings });
    let text = serde_json::to_string_pretty(&contents).map_err(|err| err.to_string())?;
    // What could not be read back is not written either.
    if text.len() as u64 > MAX_FILE_BYTES {
        return Err("too large to save".into());
    }
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    let path = dir.join(format!("{file}.json"));
    // The page can ask for this: without a limit it could fill the disk.
    if !path.exists() && count_files(dir) >= MAX_THEMES {
        return Err(format!("delete a file first: {MAX_THEMES} is the limit"));
    }
    fs::write(path, text).map_err(|err| err.to_string())?;
    Ok(file)
}

/// How many files to share there are in `dir`.
fn count_files(dir: &Path) -> usize {
    fs::read_dir(dir).map_or(0, |entries| {
        entries
            .filter_map(Result::ok)
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .count()
    })
}

/// The name as shown: trimmed, without control characters, of bounded length.
fn clean_name(name: &str) -> Option<String> {
    let cleaned: String = name
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_CHARS)
        .collect();
    (!cleaned.is_empty()).then_some(cleaned)
}

/// A file name for the theme: lowercase letters and digits, `-` for the rest.
/// It cannot contain a path separator or a dot.
fn slug(name: &str) -> Option<String> {
    let mut slug = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }
    let slug = slug.trim_end_matches('-');
    (!slug.is_empty()).then(|| slug.chars().take(64).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), value.clone()))
            .collect()
    }

    #[test]
    fn saved_themes_are_listed_again() {
        let dir = tempfile::tempdir().unwrap();
        let values = settings(&[("scheme", "midnight".into()), ("blur", 12.into())]);

        let file = save(dir.path(), "  Midnight Glass ", values.clone()).unwrap();

        assert_eq!(file, "midnight-glass");
        assert_eq!(
            list(dir.path()),
            vec![Theme {
                file: "midnight-glass".into(),
                name: "Midnight Glass".into(),
                settings: values,
            }]
        );
    }

    #[test]
    fn saving_under_the_same_name_replaces_the_theme() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), "Mine", settings(&[("blur", 1.into())])).unwrap();
        save(dir.path(), "mine", settings(&[("blur", 2.into())])).unwrap();
        let themes = list(dir.path());
        assert_eq!(themes.len(), 1);
        assert_eq!(themes[0].settings["blur"], 2);
    }

    #[test]
    fn names_cannot_reach_outside_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let file = save(dir.path(), "../../evil\\name.exe", BTreeMap::new()).unwrap();
        assert_eq!(file, "evil-name-exe");
        assert!(dir.path().join("evil-name-exe.json").is_file());
        assert!(save(dir.path(), "   ", BTreeMap::new()).is_err());
        assert!(save(dir.path(), "../..", BTreeMap::new()).is_err());
    }

    #[test]
    fn refuses_to_save_values_that_are_not_flat() {
        let dir = tempfile::tempdir().unwrap();
        let nested = settings(&[("a", serde_json::json!({ "b": 1 }))]);
        assert!(save(dir.path(), "x", nested).is_err());
        let bad_key = settings(&[("bad key", true.into())]);
        assert!(save(dir.path(), "x", bad_key).is_err());
        assert_eq!(list(dir.path()), Vec::new());
    }

    #[test]
    fn reading_drops_what_does_not_belong_in_a_theme() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("shared.json"),
            r#"{ "name": "Shared", "settings": { "scheme": "plum", "nested": { "x": 1 }, "bad key": 1, "list": [1] }, "extra": true }"#,
        )
        .unwrap();
        fs::write(dir.path().join("unnamed.json"), r#"{ "settings": {} }"#).unwrap();
        fs::write(dir.path().join("broken.json"), "{ nope").unwrap();
        fs::write(dir.path().join("notes.txt"), "not a theme").unwrap();

        let themes = list(dir.path());

        assert_eq!(themes.len(), 2);
        assert_eq!(themes[0].name, "Shared");
        assert_eq!(themes[0].settings, settings(&[("scheme", "plum".into())]));
        // A file without a name is shown under its file name.
        assert_eq!(themes[1].name, "unnamed");
    }

    #[test]
    fn missing_folder_lists_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(list(&dir.path().join("missing")), Vec::new());
    }

    #[test]
    fn saving_stops_at_the_limits() {
        let dir = tempfile::tempdir().unwrap();
        for index in 0..MAX_THEMES {
            save(dir.path(), &format!("theme {index}"), BTreeMap::new()).unwrap();
        }
        assert!(save(dir.path(), "one more", BTreeMap::new())
            .unwrap_err()
            .contains("limit"));
        // Replacing one that is there still works.
        save(dir.path(), "theme 0", BTreeMap::new()).unwrap();
        assert_eq!(count_files(dir.path()), MAX_THEMES);

        let other = tempfile::tempdir().unwrap();
        let large: BTreeMap<String, Value> = (0..8)
            .map(|index| (format!("key{index}"), Value::from("x".repeat(10_000))))
            .collect();
        assert_eq!(
            save(other.path(), "large", large).unwrap_err(),
            "too large to save"
        );
        assert_eq!(count_files(other.path()), 0);
    }
}

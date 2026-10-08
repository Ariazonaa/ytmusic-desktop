//! Local configuration stored as `settings.json` in the app config directory.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_PLUGINS: usize = 64;
const MAX_NAME_LEN: usize = 64;
const MAX_PLUGIN_SETTINGS: usize = 64;
/// Generous enough for a custom stylesheet.
const MAX_SETTING_TEXT_LEN: usize = 16 * 1024;
const LANGUAGES: [&str; 3] = ["system", "en", "de"];
/// Larger files are not settings files.
const MAX_IMPORT_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Names of the enabled plugins.
    pub plugins: Vec<String>,
    /// Launch the app when the user signs in to the OS.
    pub startup: bool,
    /// When launched at sign-in, start in the tray without showing the window.
    pub start_in_tray: bool,
    /// Closing the window hides it to the tray instead of quitting.
    pub minimize_to_tray: bool,
    /// Load the track that was playing when the app was closed, paused.
    pub resume_playback: bool,
    /// Language of the settings window: `system`, `en` or `de`.
    pub language: String,
    /// For plugin authors: reload the external plugins when a file in the
    /// plugins folder changes.
    pub reload_plugins_on_change: bool,
    /// Draw and decode video on the GPU. Off saves memory at the cost of CPU
    /// time. Read once at start: the browser cannot switch while it runs.
    pub hardware_acceleration: bool,
    /// Ask the project's releases at each start whether there is a newer version.
    pub check_for_updates: bool,
    /// Per-plugin settings by plugin name. What the keys mean is defined by
    /// each plugin's schema, which only the frontend knows.
    pub plugin_settings: BTreeMap<String, BTreeMap<String, Value>>,
    /// Global keyboard shortcuts.
    pub shortcuts: Shortcuts,
}

/// Key combinations that work while another program has the focus, written
/// like `Ctrl+Alt+ArrowUp`. An empty one is switched off, which is the
/// default: a global shortcut takes its keys away from every other program.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Shortcuts {
    pub play_pause: String,
    pub next: String,
    pub previous: String,
    pub volume_up: String,
    pub volume_down: String,
    pub toggle_mute: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            plugins: Vec::new(),
            startup: false,
            start_in_tray: false,
            minimize_to_tray: true,
            resume_playback: true,
            language: "system".into(),
            reload_plugins_on_change: false,
            hardware_acceleration: true,
            check_for_updates: true,
            plugin_settings: BTreeMap::new(),
            shortcuts: Shortcuts::default(),
        }
    }
}

impl Settings {
    /// Rejects values that could not have come from a well-behaved client.
    /// `set_settings` is callable from the remote page, so its input is untrusted.
    pub fn validate(&self) -> Result<(), String> {
        if self.plugins.len() > MAX_PLUGINS {
            return Err(format!("too many plugins (max {MAX_PLUGINS})"));
        }
        if let Some(name) = self.plugins.iter().find(|name| !is_valid_name(name)) {
            return Err(format!("invalid plugin name: {name:?}"));
        }
        if !LANGUAGES.contains(&self.language.as_str()) {
            return Err(format!("unknown language: {:?}", self.language));
        }
        crate::shortcuts::validate(&self.shortcuts)?;
        self.validate_plugin_settings()
    }

    fn validate_plugin_settings(&self) -> Result<(), String> {
        if self.plugin_settings.len() > MAX_PLUGINS {
            return Err(format!("settings for too many plugins (max {MAX_PLUGINS})"));
        }
        for (plugin, values) in &self.plugin_settings {
            if !is_valid_name(plugin) {
                return Err(format!("invalid plugin name: {plugin:?}"));
            }
            if values.len() > MAX_PLUGIN_SETTINGS {
                return Err(format!("too many settings for plugin {plugin:?}"));
            }
            for (key, value) in values {
                if !is_valid_setting_key(key) {
                    return Err(format!(
                        "invalid setting key for plugin {plugin:?}: {key:?}"
                    ));
                }
                if !is_valid_setting_value(value) {
                    return Err(format!(
                        "invalid value for setting {key:?} of plugin {plugin:?}"
                    ));
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn is_valid_setting_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_NAME_LEN
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Settings are flat: booleans, numbers and text only.
pub(crate) fn is_valid_setting_value(value: &Value) -> bool {
    match value {
        Value::Bool(_) | Value::Number(_) => true,
        Value::String(text) => text.len() <= MAX_SETTING_TEXT_LEN,
        _ => false,
    }
}

/// Whether `name` is a plugin name: lowercase letters, digits and `-`.
pub(crate) fn is_valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME_LEN
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Loads settings from `path`. A missing file yields the defaults; an
/// unreadable or invalid file is moved to `<path>.bak` and replaced by them.
pub fn load(path: &Path) -> Settings {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Settings::default(),
        Err(err) => {
            log_error!("settings: cannot read {}: {err}", path.display());
            return Settings::default();
        }
    };
    let parsed = serde_json::from_str::<Settings>(&text)
        .map_err(|err| err.to_string())
        .and_then(|settings| settings.validate().map(|()| settings));
    match parsed {
        Ok(settings) => settings,
        Err(err) => {
            log_error!(
                "settings: {} is invalid ({err}), using defaults",
                path.display()
            );
            if let Err(err) = fs::rename(path, backup_path(path)) {
                log_error!("settings: cannot back up invalid file: {err}");
            }
            Settings::default()
        }
    }
}

/// Writes settings atomically: a crash mid-write never leaves a truncated file.
pub fn save(path: &Path, settings: &Settings) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(settings)?)?;
    fs::rename(&tmp, path)
}

/// Reads settings someone exported. Unlike `load`, a bad file is an error
/// and is left alone. Keys the file lacks get their defaults.
pub fn import(path: &Path) -> Result<Settings, String> {
    let size = fs::metadata(path).map_err(|err| err.to_string())?.len();
    if size > MAX_IMPORT_BYTES {
        return Err("the file is too large to be a settings file".into());
    }
    let text = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let settings: Settings =
        serde_json::from_str(&text).map_err(|err| format!("not a settings file: {err}"))?;
    settings.validate()?;
    Ok(settings)
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

/// Settings shared across commands, kept in sync with the file on disk.
pub struct SettingsStore {
    path: PathBuf,
    current: Mutex<Settings>,
    /// There was no settings file: the app runs for the first time.
    first_run: bool,
}

impl SettingsStore {
    pub fn open(path: PathBuf) -> Self {
        let first_run = !path.exists();
        let current = Mutex::new(load(&path));
        Self {
            path,
            current,
            first_run,
        }
    }

    /// Whether the app had no settings file when it started.
    pub fn is_first_run(&self) -> bool {
        self.first_run
    }

    pub fn get(&self) -> Settings {
        self.lock().clone()
    }

    pub fn set(&self, settings: Settings) -> Result<(), String> {
        settings.validate()?;
        let mut current = self.lock();
        save(&self.path, &settings).map_err(|err| err.to_string())?;
        *current = settings;
        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Settings> {
        // Settings stay consistent even if a holder panicked: they are replaced whole.
        self.current.lock().unwrap_or_else(|err| err.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_path(dir: &tempfile::TempDir) -> PathBuf {
        dir.path().join("settings.json")
    }

    #[test]
    fn missing_file_yields_defaults() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(&settings_path(&dir)), Settings::default());
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(&dir);
        let settings = Settings {
            plugins: vec!["discord-rpc".into(), "lyrics".into()],
            startup: true,
            start_in_tray: true,
            minimize_to_tray: false,
            resume_playback: false,
            language: "de".into(),
            reload_plugins_on_change: true,
            hardware_acceleration: false,
            check_for_updates: false,
            plugin_settings: BTreeMap::from([(
                "lyrics".to_string(),
                BTreeMap::from([
                    ("provider".to_string(), Value::from("lrclib")),
                    ("fontSize".to_string(), Value::from(14)),
                    ("romanize".to_string(), Value::from(false)),
                ]),
            )]),
            shortcuts: Shortcuts {
                volume_up: "Ctrl+Alt+ArrowUp".into(),
                volume_down: "Ctrl+Alt+ArrowDown".into(),
                toggle_mute: String::new(),
                next: "Ctrl+Alt+ArrowRight".into(),
                ..Shortcuts::default()
            },
        };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
    }

    #[test]
    fn save_creates_missing_directory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("settings.json");
        save(&path, &Settings::default()).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(&dir);
        fs::write(&path, r#"{ "plugins": [] }"#).unwrap();
        let settings = load(&path);
        assert!(settings.plugins.is_empty());
        assert!(settings.minimize_to_tray);
        assert!(settings.hardware_acceleration);
    }

    #[test]
    fn json_uses_camel_case_keys() {
        let json = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(json["minimizeToTray"], true);
    }

    #[test]
    fn corrupt_file_is_backed_up_and_replaced_by_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(&dir);
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(load(&path), Settings::default());
        assert!(!path.exists());
        assert_eq!(
            fs::read_to_string(backup_path(&path)).unwrap(),
            "{ not json"
        );
    }

    #[test]
    fn validate_rejects_bad_names() {
        let with_plugin = |name: &str| Settings {
            plugins: vec![name.into()],
            ..Settings::default()
        };
        assert!(with_plugin("discord-rpc").validate().is_ok());
        assert!(with_plugin("").validate().is_err());
        assert!(with_plugin("../evil").validate().is_err());
        assert!(with_plugin(&"a".repeat(MAX_NAME_LEN + 1))
            .validate()
            .is_err());
        let too_many = Settings {
            plugins: vec!["a".into(); MAX_PLUGINS + 1],
            ..Settings::default()
        };
        assert!(too_many.validate().is_err());
    }

    #[test]
    fn validate_rejects_bad_plugin_settings() {
        let with_setting = |plugin: &str, key: &str, value: Value| Settings {
            plugin_settings: BTreeMap::from([(
                plugin.to_string(),
                BTreeMap::from([(key.to_string(), value)]),
            )]),
            ..Settings::default()
        };
        assert!(with_setting("demo", "accentColor", "red".into())
            .validate()
            .is_ok());
        assert!(with_setting("demo", "size", 1.5.into()).validate().is_ok());
        assert!(with_setting("../evil", "a", true.into())
            .validate()
            .is_err());
        assert!(with_setting("demo", "bad key", true.into())
            .validate()
            .is_err());
        assert!(with_setting("demo", "a", Value::Null).validate().is_err());
        assert!(
            with_setting("demo", "a", serde_json::json!({ "nested": 1 }))
                .validate()
                .is_err()
        );
        assert!(with_setting("demo", "a", serde_json::json!([1]))
            .validate()
            .is_err());
        let long = "x".repeat(MAX_SETTING_TEXT_LEN + 1);
        assert!(with_setting("demo", "a", long.into()).validate().is_err());
    }

    #[test]
    fn store_persists_valid_and_rejects_invalid_settings() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(&dir);
        let store = SettingsStore::open(path.clone());
        let updated = Settings {
            plugins: vec![],
            ..Settings::default()
        };
        store.set(updated.clone()).unwrap();
        assert_eq!(store.get(), updated);
        assert_eq!(load(&path), updated);

        let invalid = Settings {
            plugins: vec!["No Spaces".into()],
            ..Settings::default()
        };
        assert!(store.set(invalid).is_err());
        assert_eq!(store.get(), updated);
    }

    #[test]
    fn rejects_unknown_languages() {
        for language in ["system", "en", "de"] {
            let settings = Settings {
                language: language.into(),
                ..Settings::default()
            };
            assert!(settings.validate().is_ok(), "{language}");
        }
        let settings = Settings {
            language: "tlh".into(),
            ..Settings::default()
        };
        assert!(settings.validate().is_err());
    }

    #[test]
    fn imports_exported_settings_and_fills_in_what_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.json");
        let exported = Settings {
            plugins: vec!["lyrics".into()],
            language: "de".into(),
            ..Settings::default()
        };
        save(&path, &exported).unwrap();
        assert_eq!(import(&path), Ok(exported));

        // A file from an older version lacks the newer keys.
        fs::write(&path, r#"{ "plugins": ["themes"] }"#).unwrap();
        let imported = import(&path).unwrap();
        assert_eq!(imported.plugins, vec!["themes".to_string()]);
        assert_eq!(imported.language, "system");
    }

    #[test]
    fn a_bad_import_is_an_error_and_the_file_stays() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("export.json");
        for contents in [
            "{ nope",
            r#"{ "plugins": ["No Spaces"] }"#,
            r#"{ "language": "tlh" }"#,
            "[1, 2]",
        ] {
            fs::write(&path, contents).unwrap();
            assert!(import(&path).is_err(), "{contents}");
            assert_eq!(fs::read_to_string(&path).unwrap(), contents);
        }
        assert!(import(&dir.path().join("missing.json")).is_err());
        fs::write(&path, " ".repeat(2 * 1024 * 1024)).unwrap();
        assert!(import(&path).is_err());
    }
}

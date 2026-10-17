//! The public list of plugins from others: a file in the project's repository
//! that plugin authors add to by pull request. The settings window fetches it
//! when the user asks, and installs from it. Only addresses from the list are
//! downloaded, and only a download that matches its entry is installed: the
//! checksum, the plugin's name and the permissions and hosts the user saw.

use crate::settings::is_valid_name;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::Cursor;
use std::path::Path;
use std::sync::Mutex;

pub const LIST_URL: &str =
    "https://raw.githubusercontent.com/Ariazonaa/ytmusic-desktop/main/plugins/index.json";
const MAX_LIST_BYTES: usize = 512 * 1024;
/// The same limit as for "Install from a zip file", there for unpacked files.
const MAX_ZIP_BYTES: usize = 20 * 1024 * 1024;
const MAX_ENTRIES: usize = 500;
const MAX_URL_LENGTH: usize = 500;
const MAX_DESCRIPTION_CHARS: usize = 300;
const MAX_SHORT_CHARS: usize = 60;
const MAX_PERMISSIONS: usize = 10;
const MAX_HOSTS: usize = 20;

/// A plugin in the list, as the settings window shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    /// Where to read more: the plugin's repository or page.
    pub homepage: Option<String>,
    pub permissions: Vec<String>,
    pub hosts: Vec<String>,
    /// The zip file to install, over HTTPS.
    pub url: String,
    /// SHA-256 of that file, in lowercase hex.
    pub sha256: String,
}

/// The list as last fetched. Installing takes the address from here, never
/// from the window.
#[derive(Default)]
pub struct MarketStore(Mutex<Vec<Entry>>);

impl MarketStore {
    pub fn set(&self, entries: Vec<Entry>) {
        *self.0.lock().unwrap_or_else(|err| err.into_inner()) = entries;
    }

    pub fn find(&self, name: &str) -> Option<Entry> {
        let entries = self.0.lock().unwrap_or_else(|err| err.into_inner());
        entries.iter().find(|entry| entry.name == name).cloned()
    }
}

/// Reads the list. Entries that are not usable are left out, so that one bad
/// entry does not hide the others; so is a second entry of the same name.
pub fn parse_list(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    let value: Value =
        serde_json::from_slice(bytes).map_err(|err| format!("the list is not JSON: {err}"))?;
    let plugins = value
        .get("plugins")
        .and_then(Value::as_array)
        .ok_or("the list has no \"plugins\"")?;
    let mut entries: Vec<Entry> = Vec::new();
    for raw in plugins.iter().take(MAX_ENTRIES) {
        if let Some(entry) = parse_entry(raw) {
            if !entries.iter().any(|known| known.name == entry.name) {
                entries.push(entry);
            }
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

fn parse_entry(raw: &Value) -> Option<Entry> {
    let text = |key: &str, max: usize| -> Option<String> {
        let value = raw.get(key)?.as_str()?.trim();
        (!value.is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control))
            .then(|| value.to_owned())
    };
    let list = |key: &str, max: usize| -> Option<Vec<String>> {
        let Some(value) = raw.get(key) else {
            return Some(Vec::new());
        };
        let items = value.as_array()?;
        if items.len() > max {
            return None;
        }
        let mut out: Vec<String> = items
            .iter()
            .map(|item| item.as_str().filter(|s| is_token(s)).map(str::to_owned))
            .collect::<Option<_>>()?;
        out.sort();
        out.dedup();
        Some(out)
    };
    let name = text("name", 64).filter(|name| is_valid_name(name))?;
    let sha256 = text("sha256", 64)?.to_ascii_lowercase();
    if sha256.len() != 64 || !sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let homepage = match raw.get("homepage") {
        None | Some(Value::Null) => None,
        Some(_) => Some(text("homepage", MAX_URL_LENGTH).filter(|url| is_https(url))?),
    };
    Some(Entry {
        name,
        version: text("version", 20)?,
        description: text("description", MAX_DESCRIPTION_CHARS)?,
        author: text("author", MAX_SHORT_CHARS)?,
        homepage,
        permissions: list("permissions", MAX_PERMISSIONS)?,
        hosts: list("hosts", MAX_HOSTS)?,
        url: text("url", MAX_URL_LENGTH).filter(|url| is_https(url))?,
        sha256,
    })
}

/// A permission or host name: letters, digits, `.`, `-` and `_`.
fn is_token(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 100
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

fn is_https(url: &str) -> bool {
    url.parse::<tauri::Url>()
        .is_ok_and(|url| url.scheme() == "https" && url.host_str().is_some())
}

/// Whether `bytes` is the file the entry names.
pub fn check_download(entry: &Entry, bytes: &[u8]) -> Result<(), String> {
    let digest = Sha256::digest(bytes);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    if hex == entry.sha256 {
        Ok(())
    } else {
        Err("the download does not match the list's checksum".into())
    }
}

/// Whether the manifest in the download is the plugin the user chose: the
/// same name, and no other permissions or hosts than the list showed.
pub fn check_manifest(entry: &Entry, manifest: &Value) -> Result<(), String> {
    let set = |key: &str| -> BTreeSet<String> {
        manifest
            .get(key)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    };
    if manifest.get("name").and_then(Value::as_str) != Some(entry.name.as_str()) {
        return Err("the download is a different plugin than listed".into());
    }
    if set("permissions") != entry.permissions.iter().cloned().collect() {
        return Err("the plugin asks for other permissions than listed".into());
    }
    if set("hosts") != entry.hosts.iter().cloned().collect() {
        return Err("the plugin contacts other hosts than listed".into());
    }
    Ok(())
}

/// Installs the downloaded zip of `entry` into `plugins_dir`. It is unpacked
/// once aside to read its manifest, and only then where plugins live.
pub fn install(plugins_dir: &Path, entry: &Entry, bytes: &[u8]) -> Result<String, String> {
    check_download(entry, bytes)?;
    let aside = tempfile::tempdir().map_err(|err| err.to_string())?;
    let name = crate::install::install(aside.path(), Cursor::new(bytes))?;
    let manifest = std::fs::read(aside.path().join(&name).join("plugin.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .ok_or("the plugin has no readable plugin.json")?;
    check_manifest(entry, &manifest)?;
    crate::install::install(plugins_dir, Cursor::new(bytes))
}

pub async fn fetch_list() -> Result<Vec<Entry>, String> {
    parse_list(&crate::download::fetch(LIST_URL, MAX_LIST_BYTES).await?)
}

pub async fn fetch_plugin(entry: &Entry) -> Result<Vec<u8>, String> {
    crate::download::fetch(&entry.url, MAX_ZIP_BYTES).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    fn zip_with(manifest: &Value) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut out);
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("plugin.json", options).unwrap();
        zip.write_all(manifest.to_string().as_bytes()).unwrap();
        zip.start_file("index.js", options).unwrap();
        zip.write_all(b"// index").unwrap();
        zip.finish().unwrap();
        out.into_inner()
    }

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    fn entry(name: &str, permissions: &[&str], hosts: &[&str], sha256: &str) -> Value {
        json!({
            "name": name,
            "version": "1.0.0",
            "description": "Says hello.",
            "author": "someone",
            "homepage": "https://example.org/hello",
            "permissions": permissions,
            "hosts": hosts,
            "url": format!("https://example.org/{name}.zip"),
            "sha256": sha256,
        })
    }

    #[test]
    fn reads_the_usable_entries() {
        let good = entry(
            "hello",
            &["network", "music.read"],
            &["api.example.org"],
            &"A".repeat(64),
        );
        let mut plain_http = entry("plain", &[], &[], &"a".repeat(64));
        plain_http["url"] = json!("http://example.org/plain.zip");
        let bad = [
            entry("Bad Name", &[], &[], &"a".repeat(64)),
            entry("short-sum", &[], &[], "abc"),
            entry("odd-host", &[], &["a host"], &"a".repeat(64)),
            json!({ "name": "nothing-else" }),
            plain_http,
            entry("hello", &[], &[], &"b".repeat(64)),
        ];
        let mut plugins = vec![good];
        plugins.extend(bad);
        let list = json!({ "plugins": plugins }).to_string();
        let entries = parse_list(list.as_bytes()).unwrap();
        assert_eq!(entries.len(), 1);
        let hello = &entries[0];
        assert_eq!(hello.name, "hello");
        assert_eq!(hello.permissions, ["music.read", "network"]);
        assert_eq!(hello.sha256, "a".repeat(64));
        assert!(parse_list(b"[]").is_err());
        assert!(parse_list(b"{ nope").is_err());
    }

    #[test]
    fn installs_only_what_the_list_describes() {
        let manifest =
            json!({ "name": "hello", "version": "1.0.0", "permissions": ["music.read"] });
        let bytes = zip_with(&manifest);
        let listed: Entry =
            parse_entry(&entry("hello", &["music.read"], &[], &sha(&bytes))).unwrap();
        let dir = tempfile::tempdir().unwrap();

        let mut tampered = bytes.clone();
        tampered.push(0);
        assert!(install(dir.path(), &listed, &tampered).is_err());

        let more = parse_entry(&entry("hello", &[], &[], &sha(&bytes))).unwrap();
        assert!(install(dir.path(), &more, &bytes)
            .unwrap_err()
            .contains("permissions"));
        let other = parse_entry(&entry("other", &["music.read"], &[], &sha(&bytes))).unwrap();
        assert!(install(dir.path(), &other, &bytes)
            .unwrap_err()
            .contains("different plugin"));
        assert!(!dir.path().join("hello").exists());

        assert_eq!(install(dir.path(), &listed, &bytes).unwrap(), "hello");
        assert!(dir.path().join("hello").join("index.js").is_file());
    }

    #[test]
    fn hosts_must_match_too() {
        let listed = parse_entry(&entry(
            "hello",
            &["network"],
            &["a.example.org"],
            &"a".repeat(64),
        ))
        .unwrap();
        let manifest =
            json!({ "name": "hello", "permissions": ["network"], "hosts": ["b.example.org"] });
        assert!(check_manifest(&listed, &manifest)
            .unwrap_err()
            .contains("hosts"));
        let manifest =
            json!({ "name": "hello", "permissions": ["network"], "hosts": ["a.example.org"] });
        assert!(check_manifest(&listed, &manifest).is_ok());
    }

    #[test]
    fn the_list_lives_in_the_public_repository() {
        assert!(is_https(LIST_URL));
        assert!(LIST_URL.ends_with("/plugins/index.json"));
    }
}

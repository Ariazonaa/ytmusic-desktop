//! Installing an external plugin from a zip file, and removing one.
//!
//! A zip file comes from someone else. Only what a plugin's folder serves is
//! taken out of it, into the plugins folder and nowhere else, and only up to
//! a size no real plugin reaches.

use crate::{plugins, settings::is_valid_name};
use std::{
    fs,
    io::{self, Read, Seek},
    path::{Path, PathBuf},
};

const MAX_ENTRIES: usize = 500;
const MAX_TOTAL_BYTES: u64 = 20 * 1024 * 1024;
const MANIFEST: &str = "plugin.json";

/// Unpacks the plugin in `archive` into `plugins_dir` and returns its name.
/// A plugin of the same name is replaced. Nothing is changed if the archive
/// is not a usable plugin.
///
/// The plugin's files may lie at the top of the archive or in one folder,
/// which is how a zipped folder usually comes out.
pub fn install<R: Read + Seek>(plugins_dir: &Path, archive: R) -> Result<String, String> {
    let mut zip = zip::ZipArchive::new(archive).map_err(|err| format!("not a zip file: {err}"))?;
    if zip.len() > MAX_ENTRIES {
        return Err(format!("too many files (more than {MAX_ENTRIES})"));
    }
    let prefix = manifest_prefix(&mut zip)?;
    let name = manifest_name(&mut zip, &prefix)?;

    // Unpacked next to its final place, under a name no plugin can have, and
    // moved there only when everything is out.
    let staging = plugins_dir.join(format!(".installing-{name}"));
    let _ = fs::remove_dir_all(&staging);
    let unpacked = unpack(&mut zip, &prefix, &staging).and_then(|()| {
        if staging.join("index.js").is_file() {
            Ok(())
        } else {
            Err("the plugin has no index.js".to_owned())
        }
    });
    if let Err(reason) = unpacked {
        let _ = fs::remove_dir_all(&staging);
        return Err(reason);
    }
    let target = plugins_dir.join(&name);
    // A plugin of that name steps aside first, whole, and comes back if the
    // new one cannot take its place. Deleting it file by file could stop
    // halfway, on a file some program has open, and leave neither.
    let aside = plugins_dir.join(format!(".replaced-{name}"));
    let _ = fs::remove_dir_all(&aside);
    let had_old = match fs::rename(&target, &aside) {
        Ok(()) => true,
        Err(err) if err.kind() == io::ErrorKind::NotFound => false,
        Err(err) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("cannot replace the installed plugin: {err}"));
        }
    };
    if let Err(err) = fs::rename(&staging, &target) {
        if had_old {
            let _ = fs::rename(&aside, &target);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("cannot put the plugin in place: {err}"));
    }
    if had_old {
        let _ = fs::remove_dir_all(&aside);
    }
    Ok(name)
}

/// Deletes the plugin `name` from `plugins_dir`.
pub fn remove(plugins_dir: &Path, name: &str) -> Result<(), String> {
    if !is_valid_name(name) {
        return Err("not a plugin name".into());
    }
    let folder = plugins_dir.join(name);
    if !folder.is_dir() {
        return Err(format!("there is no plugin {name:?}"));
    }
    fs::remove_dir_all(&folder).map_err(|err| format!("cannot remove the plugin: {err}"))
}

/// Where in the archive the plugin lies: `""` for the top, or `"folder/"`.
fn manifest_prefix<R: Read + Seek>(zip: &mut zip::ZipArchive<R>) -> Result<String, String> {
    let mut found: Vec<String> = zip
        .file_names()
        .filter_map(|file| {
            let prefix = file.strip_suffix(MANIFEST)?;
            // At the top, or exactly one folder down.
            (prefix.is_empty() || (prefix.ends_with('/') && prefix.matches('/').count() == 1))
                .then(|| prefix.to_owned())
        })
        .collect();
    found.sort();
    match found.as_slice() {
        [prefix] => Ok(prefix.clone()),
        [] => Err("no plugin.json at the top of the archive or in its one folder".into()),
        // An archive with a manifest at the top holds one plugin, whatever lies deeper.
        [top, ..] if top.is_empty() => Ok(String::new()),
        _ => Err("the archive holds more than one plugin".into()),
    }
}

fn manifest_name<R: Read + Seek>(
    zip: &mut zip::ZipArchive<R>,
    prefix: &str,
) -> Result<String, String> {
    let file = zip
        .by_name(&format!("{prefix}{MANIFEST}"))
        .map_err(|err| err.to_string())?;
    let mut text = String::new();
    file.take(64 * 1024)
        .read_to_string(&mut text)
        .map_err(|err| format!("plugin.json cannot be read: {err}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&text).map_err(|err| format!("plugin.json is invalid: {err}"))?;
    match manifest["name"].as_str() {
        Some(name) if is_valid_name(name) => Ok(name.to_owned()),
        _ => Err("plugin.json has no valid name".into()),
    }
}

/// Writes the files under `prefix` that a plugin's folder serves to `target`.
/// Everything else in the archive is passed over.
fn unpack<R: Read + Seek>(
    zip: &mut zip::ZipArchive<R>,
    prefix: &str,
    target: &Path,
) -> Result<(), String> {
    let mut total = 0u64;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|err| err.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(file) = entry.name().strip_prefix(prefix).map(str::to_owned) else {
            continue;
        };
        if file != MANIFEST && !plugins::is_servable(&file) {
            continue;
        }
        // The check above only lets plain names and folders through, so this
        // cannot leave `target`.
        let path: PathBuf = target.join(&file);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let mut out = fs::File::create(&path).map_err(|err| err.to_string())?;
        // The size an archive states for a file can be a lie; what counts is
        // what comes out.
        let left = MAX_TOTAL_BYTES - total;
        let written = io::copy(&mut (&mut entry).take(left + 1), &mut out)
            .map_err(|err| format!("cannot unpack {file}: {err}"))?;
        total += written;
        if total > MAX_TOTAL_BYTES {
            return Err("the plugin is too large (more than 20 MB unpacked)".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;

    fn archive(files: &[(&str, &[u8])]) -> Cursor<Vec<u8>> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, contents) in files {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(contents).unwrap();
        }
        Cursor::new(writer.finish().unwrap().into_inner())
    }

    const MANIFEST_JSON: &[u8] = br#"{ "name": "hello", "version": "1.0.0", "permissions": [] }"#;

    #[test]
    fn installs_a_plugin_from_the_top_of_an_archive() {
        let dir = tempfile::tempdir().unwrap();
        let zip = archive(&[
            ("plugin.json", MANIFEST_JSON),
            ("index.js", b"// index"),
            ("lib/util.js", b"// util"),
            ("style.css", b"body {}"),
        ]);
        assert_eq!(install(dir.path(), zip), Ok("hello".into()));
        let hello = dir.path().join("hello");
        assert_eq!(fs::read(hello.join("index.js")).unwrap(), b"// index");
        assert!(hello.join("lib").join("util.js").is_file());
        assert!(hello.join("style.css").is_file());
        assert!(hello.join("plugin.json").is_file());
        // Nothing of the unpacking is left behind.
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn installs_a_plugin_from_the_one_folder_of_an_archive() {
        let dir = tempfile::tempdir().unwrap();
        let zip = archive(&[
            ("hello-main/plugin.json", MANIFEST_JSON),
            ("hello-main/index.js", b"// index"),
            ("hello-main/README.md", b"# Hello"),
        ]);
        assert_eq!(install(dir.path(), zip), Ok("hello".into()));
        // The folder is named after the plugin, not after the archive's folder.
        assert!(dir.path().join("hello").join("index.js").is_file());
        // Files a plugin's folder does not serve are not unpacked.
        assert!(!dir.path().join("hello").join("README.md").exists());
    }

    #[test]
    fn replaces_a_plugin_of_the_same_name() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("hello");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("index.js"), "// old").unwrap();
        fs::write(old.join("left-over.js"), "// old").unwrap();
        let zip = archive(&[("plugin.json", MANIFEST_JSON), ("index.js", b"// new")]);
        install(dir.path(), zip).unwrap();
        assert_eq!(fs::read(old.join("index.js")).unwrap(), b"// new");
        assert!(!old.join("left-over.js").exists());
    }

    #[test]
    fn leaves_no_trace_of_an_archive_that_is_not_a_plugin() {
        let dir = tempfile::tempdir().unwrap();
        let bad: Vec<(&str, Cursor<Vec<u8>>)> = vec![
            ("no manifest", archive(&[("index.js", b"x")])),
            ("no index.js", archive(&[("plugin.json", MANIFEST_JSON)])),
            (
                "bad name",
                archive(&[
                    ("plugin.json", br#"{ "name": "../evil" }"#),
                    ("index.js", b"x"),
                ]),
            ),
            (
                "broken manifest",
                archive(&[("plugin.json", b"{ nope"), ("index.js", b"x")]),
            ),
            (
                "two plugins",
                archive(&[
                    ("a/plugin.json", MANIFEST_JSON),
                    ("b/plugin.json", MANIFEST_JSON),
                ]),
            ),
            (
                "too deep",
                archive(&[("a/b/plugin.json", MANIFEST_JSON), ("a/b/index.js", b"x")]),
            ),
            ("not a zip", Cursor::new(b"hello".to_vec())),
        ];
        for (what, zip) in bad {
            assert!(install(dir.path(), zip).is_err(), "{what}");
            assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0, "{what}");
        }
    }

    #[test]
    fn an_archive_cannot_write_outside_the_plugin() {
        let dir = tempfile::tempdir().unwrap();
        let plugins = dir.path().join("plugins");
        fs::create_dir_all(&plugins).unwrap();
        let zip = archive(&[
            ("plugin.json", MANIFEST_JSON),
            ("index.js", b"// index"),
            ("../escaped.js", b"x"),
            ("lib/../../escaped.js", b"x"),
            ("/absolute.js", b"x"),
            ("C:/drive.js", b"x"),
            (".hidden.js", b"x"),
            ("run.exe", b"MZ"),
        ]);
        assert_eq!(install(&plugins, zip), Ok("hello".into()));
        assert!(!dir.path().join("escaped.js").exists());
        let unpacked: Vec<String> = fs::read_dir(plugins.join("hello"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(unpacked.len(), 2, "{unpacked:?}");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn refuses_an_archive_that_unpacks_too_large() {
        let dir = tempfile::tempdir().unwrap();
        let big = vec![b' '; 21 * 1024 * 1024];
        let zip = archive(&[
            ("plugin.json", MANIFEST_JSON),
            ("index.js", b"// index"),
            ("big.js", &big),
        ]);
        assert!(install(dir.path(), zip).unwrap_err().contains("too large"));
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn removes_a_plugin_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let plugins = dir.path().join("plugins");
        fs::create_dir_all(plugins.join("hello")).unwrap();
        fs::write(plugins.join("hello").join("index.js"), "x").unwrap();
        fs::write(dir.path().join("keep.txt"), "x").unwrap();
        for name in ["..", "../plugins", "", "Hello", "missing"] {
            assert!(remove(&plugins, name).is_err(), "{name}");
        }
        assert!(plugins.join("hello").is_dir());
        assert_eq!(remove(&plugins, "hello"), Ok(()));
        assert!(!plugins.join("hello").exists());
        assert!(dir.path().join("keep.txt").is_file());
    }
}

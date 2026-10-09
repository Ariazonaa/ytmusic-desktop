//! External plugins: folders in `<config dir>/plugins`, each with a
//! `plugin.json` and an `index.js`.
//!
//! Their code never runs in the YouTube Music page. It is served under its
//! own origin to a sandboxed iframe, with a policy that forbids network
//! access, so a plugin can only act through messages to the injected script.
//! The one exception is images, from hosts its permissions cover anyway.

use crate::settings::is_valid_name;
use serde::Serialize;
use serde_json::Value;
use std::{
    borrow::Cow,
    fs,
    path::{Path, PathBuf},
};
use tauri::{
    http::{header, Response, StatusCode},
    AppHandle, Manager, Runtime,
};

pub const SCHEME: &str = "ytmd-plugin";

// WebView2 exposes custom schemes as `http://<scheme>.localhost`.
#[cfg(any(windows, target_os = "android"))]
const ORIGIN: &str = "http://ytmd-plugin.localhost";
#[cfg(not(any(windows, target_os = "android")))]
const ORIGIN: &str = "ytmd-plugin://localhost";

/// The script that runs in the iframe before the plugin and provides its
/// `ytmd` API. Embedded in release builds.
#[cfg(not(debug_assertions))]
fn bootstrap() -> Cow<'static, [u8]> {
    include_bytes!("../../dist-inject/sandbox.js")
        .as_slice()
        .into()
}

/// Development builds read it from disk on every request, so a rebuilt
/// script is used as soon as the plugins are reloaded.
#[cfg(debug_assertions)]
fn bootstrap() -> Cow<'static, [u8]> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../dist-inject/sandbox.js");
    fs::read(path)
        .unwrap_or_else(|err| {
            log_error!("[dev] cannot read {path}: {err}");
            Vec::new()
        })
        .into()
}

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_SCRIPT_BYTES: u64 = 2 * 1024 * 1024;

/// What a plugin's folder may serve to its frame, by file extension: scripts,
/// stylesheets and images. Nothing in this list can run outside the frame.
const FILE_TYPES: [(&str, &str); 8] = [
    ("js", "text/javascript; charset=utf-8"),
    ("css", "text/css; charset=utf-8"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("svg", "image/svg+xml"),
];

/// The content type for a file name, if its kind is served at all.
fn content_type(file: &str) -> Option<&'static str> {
    let extension = file.rsplit_once('.')?.1;
    FILE_TYPES
        .iter()
        .find(|(known, _)| *known == extension)
        .map(|(_, content_type)| *content_type)
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPlugin {
    /// The folder name. The frontend checks that the manifest agrees.
    pub name: String,
    /// The parsed `plugin.json`, validated by the frontend.
    pub manifest: Value,
    /// The document to load in the plugin's iframe.
    pub frame_url: String,
}

/// The folder users put external plugins into.
pub fn dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("plugins"))
}

/// Finds the plugins in `dir`. Folders that are not usable plugins are skipped.
pub fn list(dir: &Path) -> Vec<ExternalPlugin> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut plugins: Vec<ExternalPlugin> = entries
        .filter_map(|entry| {
            let name = entry.ok()?.file_name().into_string().ok()?;
            match read_manifest(dir, &name) {
                Ok(manifest) => Some(ExternalPlugin {
                    frame_url: format!("{ORIGIN}/{name}/"),
                    name,
                    manifest,
                }),
                Err(reason) => {
                    log_error!("plugins: skipping {name:?}: {reason}");
                    None
                }
            }
        })
        .collect();
    plugins.sort_by(|a, b| a.name.cmp(&b.name));
    plugins
}

fn read_manifest(dir: &Path, name: &str) -> Result<Value, String> {
    if !is_valid_name(name) {
        return Err("folder name must be lowercase letters, digits and '-'".into());
    }
    let folder = dir.join(name);
    if !folder.join("index.js").is_file() {
        return Err("no index.js".into());
    }
    let bytes = read_limited(&folder.join("plugin.json"), MAX_MANIFEST_BYTES)
        .ok_or("plugin.json is missing or too large")?;
    serde_json::from_slice(&bytes).map_err(|err| format!("plugin.json is invalid: {err}"))
}

fn read_limited(path: &Path, max_bytes: u64) -> Option<Vec<u8>> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return None;
    }
    fs::read(path).ok()
}

/// Answers a request to the plugin scheme:
///
/// - `/_bootstrap.js`: the `ytmd` API for the iframe
/// - `/<plugin>/`: the iframe document
/// - `/<plugin>/<file>`: a script, stylesheet or image from the plugin's folder
pub fn respond(dir: &Path, path: &str) -> Response<Cow<'static, [u8]>> {
    if path == "/_bootstrap.js" {
        return script(bootstrap());
    }
    let Some((name, file)) = path.trim_start_matches('/').split_once('/') else {
        return not_found();
    };
    if !is_valid_name(name) {
        return not_found();
    }
    if file.is_empty() {
        return match read_manifest(dir, name) {
            Ok(manifest) => frame_document(&manifest),
            Err(_) => not_found(),
        };
    }
    let Some(content_type) = content_type(file) else {
        return not_found();
    };
    match file_path(dir, name, file).and_then(|path| read_limited(&path, MAX_SCRIPT_BYTES)) {
        Some(bytes) => base_response(StatusCode::OK, content_type)
            .body(bytes.into())
            .expect("static headers are valid"),
        None => not_found(),
    }
}

/// Whether `file`, a path relative to a plugin's folder, is one the folder
/// serves: of a served kind, and made of plain names only, so that it cannot
/// point anywhere else.
pub fn is_servable(file: &str) -> bool {
    let is_plain_segment = |segment: &str| {
        !segment.is_empty()
            && !segment.starts_with('.')
            && segment
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    };
    content_type(file).is_some() && file.split('/').all(is_plain_segment)
}

/// Resolves a file inside a plugin's folder, refusing anything that could
/// point outside of it.
fn file_path(dir: &Path, name: &str, file: &str) -> Option<PathBuf> {
    if !is_servable(file) {
        return None;
    }
    // Canonical paths also catch links that lead out of the folder.
    let folder = dir.join(name).canonicalize().ok()?;
    let path = folder.join(file).canonicalize().ok()?;
    path.starts_with(&folder).then_some(path)
}

/// Where YouTube Music's cover art is served from.
const COVER_SOURCES: [&str; 3] = [
    "https://*.ytimg.com",
    "https://*.googleusercontent.com",
    "https://*.ggpht.com",
];

/// Mirrors `HOST_PATTERN` in `src/core/plugin-manager/api.ts`.
fn is_host_name(host: &str) -> bool {
    host.len() <= 253
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

/// The network sources a plugin's document may show images from.
///
/// An image request can carry data in its address, so it is only allowed
/// where the plugin's permissions already let that data go: `network` covers
/// the manifest's `hosts`, and `music.read` covers the covers of the songs it
/// is told about, on Google's image servers.
fn image_sources(manifest: &Value) -> Vec<String> {
    let has = |permission: &str| {
        manifest["permissions"]
            .as_array()
            .is_some_and(|list| list.iter().any(|entry| entry == permission))
    };
    let mut sources = Vec::new();
    if has("music.read") {
        sources.extend(COVER_SOURCES.map(String::from));
    }
    if has("network") {
        let hosts = manifest["hosts"].as_array().into_iter().flatten();
        // Anything but a plain host name could smuggle more into the policy.
        sources.extend(
            hosts
                .filter_map(Value::as_str)
                .filter(|host| is_host_name(host))
                .take(32)
                .map(|host| format!("https://{host}")),
        );
    }
    sources
}

fn frame_document(manifest: &Value) -> Response<Cow<'static, [u8]>> {
    // The styles are defaults for a plugin that shows its document as a panel.
    const HTML: &str = "<!doctype html><meta charset=\"utf-8\">\
        <style>html{color-scheme:dark}\
        body{margin:0;padding:16px;background:#0f0f0f;color:#fff;\
        font:14px/1.5 Roboto,Arial,sans-serif}</style>\
        <body>\
        <script src=\"/_bootstrap.js\"></script>\
        <script type=\"module\" src=\"index.js\"></script>";
    // `sandbox` gives the document an opaque origin: no cookies, no storage,
    // no access to the embedding page. Scripts may only come from this
    // scheme, and nothing may be contacted. Styles and images may be inline
    // or come from the plugin's own folder, which this scheme serves; images
    // from the network are limited to the sources the plugin's permissions cover.
    let mut policy = format!(
        "sandbox allow-scripts; default-src 'none'; form-action 'none'; base-uri 'none'; \
         script-src {ORIGIN}; \
         style-src 'unsafe-inline' {ORIGIN}; img-src data: blob: {ORIGIN}"
    );
    for source in image_sources(manifest) {
        policy.push(' ');
        policy.push_str(&source);
    }
    base_response(StatusCode::OK, "text/html; charset=utf-8")
        .header(header::CONTENT_SECURITY_POLICY, policy)
        .header(header::REFERRER_POLICY, "no-referrer")
        .body(HTML.as_bytes().into())
        .expect("static headers are valid")
}

fn script(body: Cow<'static, [u8]>) -> Response<Cow<'static, [u8]>> {
    base_response(StatusCode::OK, FILE_TYPES[0].1)
        .body(body)
        .expect("static headers are valid")
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    base_response(StatusCode::NOT_FOUND, "text/plain; charset=utf-8")
        .body(Cow::Borrowed(&b"not found"[..]))
        .expect("static headers are valid")
}

fn base_response(status: StatusCode, content_type: &str) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        // The sandboxed iframe has an opaque origin, so its module scripts are
        // cross-origin requests.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
}

/// What to do with a navigation of a frame in the main window.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
pub enum FrameNavigation {
    Allow,
    /// The frame shows a plugin from now on: remember the address as its home.
    Adopt,
    Cancel,
}

/// Decides about a frame going to `uri`. `home` is the plugin document the
/// frame loaded first, if it is a plugin's frame. Such a frame may load that
/// document again and nothing else: not another site, and not another
/// plugin's document, which would then act with this plugin's permissions.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn frame_navigation(home: Option<&str>, uri: &str) -> FrameNavigation {
    match home {
        Some(home) if home == uri => FrameNavigation::Allow,
        Some(_) => FrameNavigation::Cancel,
        None if uri.starts_with(&format!("{ORIGIN}/")) => FrameNavigation::Adopt,
        None => FrameNavigation::Allow,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let hello = dir.path().join("hello");
        fs::create_dir_all(hello.join("lib")).unwrap();
        fs::write(hello.join("plugin.json"), r#"{ "name": "hello" }"#).unwrap();
        fs::write(hello.join("index.js"), "// index").unwrap();
        fs::write(hello.join("lib").join("util.js"), "// util").unwrap();
        fs::write(hello.join("secret.txt"), "secret").unwrap();
        fs::write(dir.path().join("outside.js"), "// outside").unwrap();
        dir
    }

    fn body(response: &Response<Cow<'static, [u8]>>) -> String {
        String::from_utf8(response.body().to_vec()).unwrap()
    }

    #[test]
    fn lists_valid_plugins_only() {
        let dir = plugin_dir();
        for (name, manifest, index) in [
            ("no-index", Some("{}"), false),
            ("no-manifest", None, true),
            ("bad-json", Some("{ nope"), true),
            ("Bad Name", Some("{}"), true),
        ] {
            let folder = dir.path().join(name);
            fs::create_dir_all(&folder).unwrap();
            if let Some(manifest) = manifest {
                fs::write(folder.join("plugin.json"), manifest).unwrap();
            }
            if index {
                fs::write(folder.join("index.js"), "").unwrap();
            }
        }

        let plugins = list(dir.path());

        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].name, "hello");
        assert_eq!(plugins[0].manifest["name"], "hello");
        assert_eq!(plugins[0].frame_url, format!("{ORIGIN}/hello/"));
    }

    #[test]
    fn missing_plugin_folder_lists_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(list(&dir.path().join("missing")), Vec::new());
    }

    #[test]
    fn frame_document_is_sandboxed_and_offline() {
        let dir = plugin_dir();
        let response = respond(dir.path(), "/hello/");
        assert_eq!(response.status(), StatusCode::OK);
        let policy = response.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(policy.contains("sandbox allow-scripts;"));
        assert!(policy.contains("default-src 'none'"));
        assert!(!policy.contains("allow-same-origin"));
        // Nothing in the policy may name a network scheme or a wildcard.
        for forbidden in ["https:", "wss:", "*", "connect-src", "frame-src"] {
            assert!(!policy.contains(forbidden), "{forbidden}");
        }
        assert!(body(&response).contains("src=\"index.js\""));
    }

    fn policy_for(manifest: &str) -> String {
        let dir = plugin_dir();
        fs::write(dir.path().join("hello").join("plugin.json"), manifest).unwrap();
        let response = respond(dir.path(), "/hello/");
        assert_eq!(response.status(), StatusCode::OK);
        response.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .to_owned()
    }

    #[test]
    fn images_may_come_from_where_the_permissions_reach() {
        let covers = "https://*.ytimg.com https://*.googleusercontent.com https://*.ggpht.com";
        let policy =
            policy_for(r#"{ "name": "hello", "permissions": ["music.read", "ui.inject"] }"#);
        assert!(policy.ends_with(&format!("img-src data: blob: {ORIGIN} {covers}")));

        let policy = policy_for(
            r#"{ "name": "hello", "permissions": ["network"], "hosts": ["api.example.org", "img.example.org"] }"#,
        );
        assert!(policy.ends_with(&format!(
            "img-src data: blob: {ORIGIN} https://api.example.org https://img.example.org"
        )));
        // Images are the only thing let through.
        assert!(!policy.contains("connect-src"));

        // Hosts without the permission count for nothing.
        let policy =
            policy_for(r#"{ "name": "hello", "permissions": [], "hosts": ["api.example.org"] }"#);
        assert!(policy.ends_with(&format!("img-src data: blob: {ORIGIN}")));
    }

    #[test]
    fn serves_stylesheets_and_images_with_their_types() {
        let dir = plugin_dir();
        let hello = dir.path().join("hello");
        fs::write(hello.join("style.css"), "body { color: red }").unwrap();
        fs::write(hello.join("lib").join("icon.png"), [0x89, b'P', b'N', b'G']).unwrap();
        fs::write(hello.join("logo.svg"), "<svg/>").unwrap();
        for (path, expected) in [
            ("/hello/style.css", "text/css; charset=utf-8"),
            ("/hello/lib/icon.png", "image/png"),
            ("/hello/logo.svg", "image/svg+xml"),
            ("/hello/index.js", "text/javascript; charset=utf-8"),
        ] {
            let response = respond(dir.path(), path);
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            assert_eq!(response.headers()[header::CONTENT_TYPE], expected, "{path}");
            assert_eq!(
                response.headers()[header::X_CONTENT_TYPE_OPTIONS],
                "nosniff"
            );
        }
        // Other kinds stay unreachable, whatever they contain.
        fs::write(hello.join("page.html"), "<script>1</script>").unwrap();
        fs::write(hello.join("data.json"), "{}").unwrap();
        fs::write(hello.join("font.woff2"), "x").unwrap();
        for path in [
            "/hello/page.html",
            "/hello/data.json",
            "/hello/font.woff2",
            "/hello/css",
            "/hello/style.CSS",
        ] {
            assert_eq!(
                respond(dir.path(), path).status(),
                StatusCode::NOT_FOUND,
                "{path}"
            );
        }
    }

    #[test]
    fn hosts_cannot_add_anything_else_to_the_policy() {
        let policy = policy_for(
            r#"{ "name": "hello", "permissions": ["network"], "hosts": [
                "ok.example", "*", "*.example.org", "evil.example; script-src *", "a b",
                "http://x.example", "x.example/path", "x.example:8080", "'unsafe-inline'",
                "", ".", "localhost", "UPPER.example", 5
            ] }"#,
        );
        assert!(
            policy.ends_with(&format!("img-src data: blob: {ORIGIN} https://ok.example")),
            "{policy}"
        );
    }

    #[test]
    fn no_frame_without_a_readable_manifest() {
        let dir = plugin_dir();
        fs::write(dir.path().join("hello").join("plugin.json"), "{ nope").unwrap();
        assert_eq!(
            respond(dir.path(), "/hello/").status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn serves_scripts_from_the_plugin_folder() {
        let dir = plugin_dir();
        assert_eq!(body(&respond(dir.path(), "/hello/index.js")), "// index");
        assert_eq!(body(&respond(dir.path(), "/hello/lib/util.js")), "// util");
        assert_eq!(
            respond(dir.path(), "/_bootstrap.js").status(),
            StatusCode::OK
        );
    }

    #[test]
    fn refuses_everything_else() {
        let dir = plugin_dir();
        for path in [
            "/",
            "/hello",
            "/missing/",
            "/missing/index.js",
            "/hello/secret.txt",
            "/hello/plugin.json",
            "/hello/../outside.js",
            "/hello/lib/../../outside.js",
            "/hello/%2e%2e/outside.js",
            "/hello/..\\outside.js",
            "/hello//index.js",
            "/hello/.hidden.js",
            "/../outside.js",
            "/Bad Name/index.js",
        ] {
            let status = respond(dir.path(), path).status();
            assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
        }
    }

    #[test]
    fn a_plugin_frame_may_only_load_its_own_document() {
        let home = format!("{ORIGIN}/hello/");
        // Frames of the page itself are none of our business.
        assert_eq!(
            frame_navigation(None, "https://accounts.google.com/x"),
            FrameNavigation::Allow
        );
        assert_eq!(
            frame_navigation(None, "about:blank"),
            FrameNavigation::Allow
        );
        assert_eq!(frame_navigation(None, &home), FrameNavigation::Adopt);
        assert_eq!(frame_navigation(Some(&home), &home), FrameNavigation::Allow);
        for away in [
            "https://example.com/?leak=song",
            "about:blank",
            &format!("{ORIGIN}/other/"),
            &format!("{ORIGIN}/hello/?leak"),
        ] {
            assert_eq!(
                frame_navigation(Some(&home), away),
                FrameNavigation::Cancel,
                "{away}"
            );
        }
        // An address that only looks like the plugins' origin is not one.
        assert_eq!(
            frame_navigation(None, &format!("{ORIGIN}.example.com/hello/")),
            FrameNavigation::Allow
        );
    }
}

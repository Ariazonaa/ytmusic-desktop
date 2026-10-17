//! "Now playing" for streaming software such as OBS: the playing track as
//! files in `<config dir>/now-playing`, and on request as a small page on
//! 127.0.0.1 that a browser source shows.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

const FOLDER: &str = "now-playing";
const MAX_TEXT_CHARS: usize = 500;
const MAX_FIELD_CHARS: usize = 300;
pub const MIN_PORT: u16 = 1024;

/// What is playing, as the page reports it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub paused: bool,
}

impl Track {
    fn bounded(self) -> Self {
        let cut = |text: String| {
            text.chars()
                .filter(|c| !c.is_control())
                .take(MAX_FIELD_CHARS)
                .collect()
        };
        Self {
            title: cut(self.title),
            artist: cut(self.artist),
            album: cut(self.album),
            paused: self.paused,
        }
    }
}

#[derive(Default)]
struct Shared {
    track: Track,
    cover: Option<Vec<u8>>,
    cover_url: Option<String>,
    /// Counts the changes, so that the page knows when to fetch the cover again.
    version: u64,
}

/// The state behind the files and the page.
#[derive(Default)]
pub struct NowPlaying {
    shared: Arc<Mutex<Shared>>,
    server: Mutex<Option<Server>>,
}

struct Server {
    port: u16,
    stop: Arc<AtomicBool>,
}

pub fn dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join(FOLDER))
}

/// Writes `bytes` to `path` whole: a reader never sees half a file.
fn write_whole(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let partial = path.with_extension("partial");
    fs::write(&partial, bytes)?;
    fs::rename(&partial, path)
}

impl NowPlaying {
    /// Takes the playing track, writes the files and returns whether the
    /// cover has to be fetched (it is another one than before).
    pub fn update(
        &self,
        dir: &Path,
        text: &str,
        track: Track,
        cover_url: Option<String>,
    ) -> Result<bool, String> {
        let track = track.bounded();
        let text: String = text
            .chars()
            .filter(|c| *c == '\n' || !c.is_control())
            .take(MAX_TEXT_CHARS)
            .collect();
        let mut shared = self.shared.lock().unwrap_or_else(|err| err.into_inner());
        let new_cover = cover_url != shared.cover_url;
        if new_cover {
            shared.cover = None;
            shared.cover_url.clone_from(&cover_url);
        }
        shared.track = track.clone();
        shared.version += 1;
        drop(shared);
        fs::create_dir_all(dir).map_err(|err| err.to_string())?;
        write_whole(&dir.join("now-playing.txt"), text.as_bytes())
            .map_err(|err| err.to_string())?;
        let json = serde_json::to_vec_pretty(&track).map_err(|err| err.to_string())?;
        write_whole(&dir.join("now-playing.json"), &json).map_err(|err| err.to_string())?;
        if new_cover && cover_url.is_none() {
            let _ = fs::remove_file(dir.join("cover.jpg"));
        }
        Ok(new_cover && cover_url.is_some())
    }

    /// Keeps the cover fetched for `url`, unless another track came meanwhile.
    pub fn set_cover(&self, dir: &Path, url: &str, bytes: Vec<u8>) -> Result<(), String> {
        let mut shared = self.shared.lock().unwrap_or_else(|err| err.into_inner());
        if shared.cover_url.as_deref() != Some(url) {
            return Ok(());
        }
        write_whole(&dir.join("cover.jpg"), &bytes).map_err(|err| err.to_string())?;
        shared.cover = Some(bytes);
        shared.version += 1;
        Ok(())
    }

    /// Serves the page on `port`, or stops serving with `None`.
    pub fn serve(&self, port: Option<u16>) -> Result<(), String> {
        let mut server = self.server.lock().unwrap_or_else(|err| err.into_inner());
        if server.as_ref().map(|running| running.port) == port {
            return Ok(());
        }
        if let Some(running) = server.take() {
            running.stop.store(true, Ordering::Relaxed);
        }
        let Some(port) = port else {
            return Ok(());
        };
        if port < MIN_PORT {
            return Err(format!("the port must be {MIN_PORT} or higher"));
        }
        let listener = TcpListener::bind(("127.0.0.1", port))
            .map_err(|err| format!("cannot use port {port}: {err}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|err| err.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let shared = Arc::clone(&self.shared);
        let stopped = Arc::clone(&stop);
        std::thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let shared = Arc::clone(&shared);
                        std::thread::spawn(move || answer(stream, port, &shared));
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(100)),
                }
            }
        });
        *server = Some(Server { port, stop });
        Ok(())
    }
}

/// The page for a browser source: cover and track, updated every second.
const PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>Now playing</title>
<style>
html,body{margin:0;background:transparent;font:600 28px/1.25 system-ui,sans-serif;color:#fff;text-shadow:0 2px 6px #000a}
main{display:flex;align-items:center;gap:20px;padding:16px}
img{width:120px;height:120px;object-fit:cover;border-radius:10px;box-shadow:0 4px 16px #0008}
img[hidden]{display:none}
small{display:block;font-weight:400;font-size:22px;opacity:.85}
.paused{opacity:.5}
</style>
<main><img id=c alt="" hidden><div><span id=t></span><small id=a></small></div></main>
<script>
let shown = -1;
async function tick() {
  try {
    const now = await (await fetch("now-playing.json", { cache: "no-store" })).json();
    document.getElementById("t").textContent = now.title;
    document.getElementById("a").textContent = now.artist;
    document.querySelector("main").className = now.paused ? "paused" : "";
    const cover = document.getElementById("c");
    cover.hidden = !now.cover;
    if (now.cover && now.version !== shown) cover.src = "cover.jpg?" + now.version;
    shown = now.version;
  } catch {}
}
tick();
setInterval(tick, 1000);
</script>"#;

#[derive(Serialize)]
struct Status<'a> {
    #[serde(flatten)]
    track: &'a Track,
    cover: bool,
    version: u64,
}

/// Answers one request. Only for this machine: the `Host` must be the
/// address served, so that a web page cannot reach it under a name of its own.
fn answer(mut stream: TcpStream, port: u16, shared: &Mutex<Shared>) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buffer = [0u8; 4096];
    let Ok(read) = stream.read(&mut buffer) else {
        return;
    };
    let request = String::from_utf8_lossy(&buffer[..read]);
    let (status, kind, body) = respond(&request, port, shared);
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
}

fn respond(
    request: &str,
    port: u16,
    shared: &Mutex<Shared>,
) -> (&'static str, &'static str, Vec<u8>) {
    let mut lines = request.lines();
    let mut parts = lines.next().unwrap_or_default().split(' ');
    let (method, target) = (
        parts.next().unwrap_or_default(),
        parts.next().unwrap_or_default(),
    );
    let host = lines
        .find_map(|line| {
            line.strip_prefix("Host:")
                .or_else(|| line.strip_prefix("host:"))
        })
        .map(str::trim)
        .unwrap_or_default();
    let allowed = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    if !allowed.iter().any(|name| name == host) {
        return ("403 Forbidden", "text/plain", b"forbidden".to_vec());
    }
    if method != "GET" {
        return ("405 Method Not Allowed", "text/plain", Vec::new());
    }
    let path = target.split('?').next().unwrap_or_default();
    let shared = shared.lock().unwrap_or_else(|err| err.into_inner());
    match path {
        "/" => (
            "200 OK",
            "text/html; charset=utf-8",
            PAGE.as_bytes().to_vec(),
        ),
        "/now-playing.json" => {
            let status = Status {
                track: &shared.track,
                cover: shared.cover.is_some(),
                version: shared.version,
            };
            (
                "200 OK",
                "application/json",
                serde_json::to_vec(&status).unwrap_or_default(),
            )
        }
        "/cover.jpg" => match &shared.cover {
            Some(bytes) => (
                "200 OK",
                crate::cover::image_extension(bytes).map_or("application/octet-stream", |ext| {
                    match ext {
                        "png" => "image/png",
                        "webp" => "image/webp",
                        _ => "image/jpeg",
                    }
                }),
                bytes.clone(),
            ),
            None => ("404 Not Found", "text/plain", Vec::new()),
        },
        _ => ("404 Not Found", "text/plain", Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(title: &str) -> Track {
        Track {
            title: title.into(),
            artist: "Maroon 5".into(),
            album: String::new(),
            paused: false,
        }
    }

    #[test]
    fn writes_the_files_and_asks_for_a_new_cover_only() {
        let dir = tempfile::tempdir().unwrap();
        let now = NowPlaying::default();
        let url = Some("https://i.ytimg.com/vi/x/hqdefault.jpg".to_string());
        assert!(now
            .update(dir.path(), "Maroon 5 – Sugar", track("Sugar"), url.clone())
            .unwrap());
        assert_eq!(
            fs::read_to_string(dir.path().join("now-playing.txt")).unwrap(),
            "Maroon 5 – Sugar"
        );
        let json: Track =
            serde_json::from_slice(&fs::read(dir.path().join("now-playing.json")).unwrap())
                .unwrap();
        assert_eq!(json.title, "Sugar");
        // Paused: same cover, nothing to fetch.
        let mut paused = track("Sugar");
        paused.paused = true;
        assert!(!now.update(dir.path(), "x", paused, url.clone()).unwrap());

        now.set_cover(dir.path(), url.as_deref().unwrap(), vec![0xFF, 0xD8, 0xFF])
            .unwrap();
        assert!(dir.path().join("cover.jpg").exists());
        // A cover that arrives for a track no longer playing is dropped.
        now.update(dir.path(), "y", track("Other"), None).unwrap();
        assert!(!dir.path().join("cover.jpg").exists());
        now.set_cover(dir.path(), url.as_deref().unwrap(), vec![1])
            .unwrap();
        assert!(!dir.path().join("cover.jpg").exists());
    }

    #[test]
    fn keeps_texts_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let now = NowPlaying::default();
        now.update(
            dir.path(),
            &"x".repeat(2000),
            track(&"t\u{0007}".repeat(400)),
            None,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("now-playing.txt"))
                .unwrap()
                .len(),
            MAX_TEXT_CHARS
        );
        let json: Track =
            serde_json::from_slice(&fs::read(dir.path().join("now-playing.json")).unwrap())
                .unwrap();
        assert_eq!(json.title, "t".repeat(MAX_FIELD_CHARS));
    }

    #[test]
    fn answers_this_machine_only() {
        let shared = Mutex::new(Shared {
            track: track("Sugar"),
            ..Shared::default()
        });
        let get = |path: &str, host: &str| {
            respond(
                &format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n"),
                4000,
                &shared,
            )
        };
        assert_eq!(get("/", "127.0.0.1:4000").0, "200 OK");
        assert_eq!(get("/", "localhost:4000").0, "200 OK");
        let (status, _, body) = get("/now-playing.json?x", "127.0.0.1:4000");
        assert_eq!(status, "200 OK");
        assert!(String::from_utf8(body)
            .unwrap()
            .contains("\"title\":\"Sugar\""));
        assert_eq!(get("/", "evil.example:4000").0, "403 Forbidden");
        assert_eq!(get("/", "127.0.0.1:4001").0, "403 Forbidden");
        assert_eq!(get("/cover.jpg", "127.0.0.1:4000").0, "404 Not Found");
        assert_eq!(
            get("/../settings.json", "127.0.0.1:4000").0,
            "404 Not Found"
        );
        assert_eq!(
            respond(
                "POST / HTTP/1.1\r\nHost: 127.0.0.1:4000\r\n\r\n",
                4000,
                &shared
            )
            .0,
            "405 Method Not Allowed"
        );
    }

    #[test]
    fn serves_and_stops() {
        let now = NowPlaying::default();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        now.serve(Some(port)).unwrap();
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(stream, "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        assert!(reply.starts_with("HTTP/1.1 200 OK"));
        assert!(reply.contains("Now playing"));
        now.serve(None).unwrap();
        assert!(now.serve(Some(80)).is_err());
    }
}

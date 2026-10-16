//! Discord Rich Presence: shows in the user's Discord profile what is playing.
//!
//! Discord's desktop client listens on a local pipe (Windows) or socket
//! (Linux). A message there is a frame: opcode and length as 32-bit little
//! endian numbers, then JSON. After a handshake with the application's id,
//! `SET_ACTIVITY` sets the status. Discord answers every frame.
//!
//! The page asks for a status through `discord_set_activity`. Everything it
//! sends is checked here, since the page is not trusted: texts are cut to
//! Discord's limits, the cover has to be an https address, the button always
//! leads to music.youtube.com. A worker thread sends the newest status at
//! most every few seconds, as Discord allows, and connects again when Discord
//! is started later or restarted.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// The Discord application "YouTube Music"; its name shows in the profile.
const CLIENT_ID: &str = "1560439254881009684";
/// Discord allows about five updates in 20 seconds.
const MIN_INTERVAL: Duration = Duration::from_secs(4);
/// How often to look for Discord while it is not running.
const RETRY_INTERVAL: Duration = Duration::from_secs(15);
const MAX_TEXT_CHARS: usize = 128;
const MAX_URL_CHARS: usize = 256;
const MAX_FRAME_BYTES: u32 = 64 * 1024;
/// Where the button "get the app" leads.
const REPOSITORY: &str = "https://github.com/Ariazonaa/ytmusic-desktop";
/// The app's icon, shown small on the cover.
const APP_ICON_URL: &str =
    "https://raw.githubusercontent.com/Ariazonaa/ytmusic-desktop/main/src-tauri/icons/128x128.png";
/// Sent again this often, so that a restarted Discord shows the status again.
const HEARTBEAT: Duration = Duration::from_secs(30);

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;

/// What the page asks Discord to show: the track, and the choices from the
/// plugin's settings.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityRequest {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover_url: Option<String>,
    /// When the track started, in milliseconds since 1970, for the progress bar.
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
    /// The track's id on YouTube, for the links and the button.
    pub video_id: Option<String>,
    #[serde(default)]
    pub paused: bool,
    /// What the member list shows after "Listening to": `app`, `artist` or `title`.
    #[serde(default)]
    pub display: String,
    #[serde(default)]
    pub show_cover: bool,
    #[serde(default)]
    pub show_progress: bool,
    /// Title and artist link to YouTube Music.
    #[serde(default)]
    pub show_links: bool,
    /// The app's icon on the cover, with `small_text` when hovering it.
    #[serde(default)]
    pub small_text: Option<String>,
    /// The texts of the buttons, in the user's language; `None` leaves a button out.
    #[serde(default)]
    pub listen_label: Option<String>,
    #[serde(default)]
    pub app_label: Option<String>,
}

/// The activity as Discord gets it, after checking.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Activity {
    #[serde(rename = "type")]
    kind: u8,
    /// What the member list names: 0 the app, 1 `state`, 2 `details`.
    status_display_type: u8,
    details: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details_url: Option<String>,
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    state_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamps: Option<Timestamps>,
    assets: Assets,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    buttons: Vec<Button>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct Timestamps {
    start: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    end: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct Assets {
    #[serde(skip_serializing_if = "Option::is_none")]
    large_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    large_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    small_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    small_text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct Button {
    label: String,
    url: String,
}

/// Discord wants at least two characters and at most 128.
fn text(value: &str) -> String {
    let trimmed: String = value.trim().chars().take(MAX_TEXT_CHARS).collect();
    match trimmed.chars().count() {
        0 => "--".into(),
        1 => format!("{trimmed} "),
        _ => trimmed,
    }
}

/// A button's text: at most 32 characters.
fn label(value: Option<&str>) -> Option<String> {
    value
        .map(|label| label.trim().chars().take(32).collect::<String>())
        .filter(|label| !label.is_empty())
}

fn is_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// YouTube Music's search for an artist; the page does not know the artist's own page.
fn search_url(artist: &str) -> Option<String> {
    let url =
        tauri::Url::parse_with_params("https://music.youtube.com/search", [("q", artist.trim())])
            .ok()?;
    Some(url.to_string()).filter(|url| url.len() <= MAX_URL_CHARS)
}

/// Checks what the page sent. `now_ms` is the current time.
pub fn check(request: &ActivityRequest, now_ms: u64) -> Activity {
    const DAY_MS: u64 = 24 * 60 * 60 * 1000;
    let plausible = |ms: u64| ms + DAY_MS > now_ms && ms < now_ms + DAY_MS;
    let timestamps = request
        .start_ms
        .filter(|&start| request.show_progress && !request.paused && plausible(start))
        .map(|start| Timestamps {
            start,
            end: request.end_ms.filter(|&end| end > start && plausible(end)),
        });
    let large_image = request
        .cover_url
        .as_deref()
        .filter(|url| {
            request.show_cover
                && url.starts_with("https://")
                && url.len() <= MAX_URL_CHARS
                && !url.chars().any(char::is_whitespace)
        })
        .map(str::to_owned);
    let large_text = (!request.album.trim().is_empty()).then(|| text(&request.album));
    let video = request.video_id.as_deref().filter(|id| is_video_id(id));
    let track_url = video.map(|id| format!("https://music.youtube.com/watch?v={id}"));
    let mut buttons = Vec::new();
    if let (Some(label), Some(url)) = (label(request.listen_label.as_deref()), track_url.clone()) {
        buttons.push(Button { label, url });
    }
    if let Some(label) = label(request.app_label.as_deref()) {
        buttons.push(Button {
            label,
            url: REPOSITORY.into(),
        });
    }
    let small_text = request.small_text.as_deref().map(text);
    Activity {
        // 2: "Listening to".
        kind: 2,
        status_display_type: match request.display.as_str() {
            "artist" => 1,
            "title" => 2,
            _ => 0,
        },
        details: text(&request.title),
        details_url: track_url.filter(|_| request.show_links),
        state: text(&request.artist),
        state_url: search_url(&request.artist).filter(|_| request.show_links),
        timestamps,
        assets: Assets {
            large_image,
            large_text,
            small_image: small_text.is_some().then(|| APP_ICON_URL.into()),
            small_text,
        },
        buttons,
    }
}

fn encode(op: u32, payload: &Value) -> Vec<u8> {
    let body = payload.to_string().into_bytes();
    let mut frame = Vec::with_capacity(8 + body.len());
    frame.extend_from_slice(&op.to_le_bytes());
    frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
    frame.extend_from_slice(&body);
    frame
}

fn read_frame(stream: &mut impl Read) -> std::io::Result<(u32, Value)> {
    let mut header = [0u8; 8];
    stream.read_exact(&mut header)?;
    let op = u32::from_le_bytes(header[..4].try_into().expect("four bytes"));
    let len = u32::from_le_bytes(header[4..].try_into().expect("four bytes"));
    if len > MAX_FRAME_BYTES {
        return Err(std::io::Error::other("Discord sent an oversized frame"));
    }
    let mut body = vec![0u8; len as usize];
    stream.read_exact(&mut body)?;
    let value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    Ok((op, value))
}

trait Stream: Read + Write + Send {}
impl<T: Read + Write + Send> Stream for T {}

/// The places Discord's client listens, by system.
fn connect() -> Option<Box<dyn Stream>> {
    #[cfg(windows)]
    {
        (0..10).find_map(|n| {
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(format!(r"\\.\pipe\discord-ipc-{n}"))
                .ok()
                .map(|pipe| Box::new(pipe) as Box<dyn Stream>)
        })
    }
    #[cfg(unix)]
    {
        let base = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
            .iter()
            .find_map(std::env::var_os)
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| "/tmp".into());
        // Flatpak and Snap put the socket in a folder of their own.
        let dirs = [
            base.clone(),
            base.join("app/com.discordapp.Discord"),
            base.join("snap.discord"),
        ];
        dirs.iter()
            .flat_map(|dir| (0..10).map(move |n| dir.join(format!("discord-ipc-{n}"))))
            .find_map(|path| std::os::unix::net::UnixStream::connect(path).ok())
            .map(|socket| Box::new(socket) as Box<dyn Stream>)
    }
    #[cfg(not(any(windows, unix)))]
    {
        None
    }
}

/// A connection that has passed the handshake.
struct Connection {
    stream: Box<dyn Stream>,
    nonce: u64,
}

impl Connection {
    fn open() -> Option<Self> {
        let mut stream = connect()?;
        stream
            .write_all(&encode(
                OP_HANDSHAKE,
                &json!({ "v": 1, "client_id": CLIENT_ID }),
            ))
            .ok()?;
        // READY, or an error frame if the id is wrong.
        let (op, answer) = read_frame(&mut stream).ok()?;
        if op != OP_FRAME || answer["evt"] != "READY" {
            log_error!("Discord did not accept the connection: {answer}");
            return None;
        }
        Some(Self { stream, nonce: 0 })
    }

    fn set(&mut self, activity: Option<&Activity>) -> std::io::Result<()> {
        self.nonce += 1;
        let message = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": self.nonce.to_string(),
        });
        self.stream.write_all(&encode(OP_FRAME, &message))?;
        // Discord answers each command; reading keeps the pipe from filling up.
        let (_, answer) = read_frame(&mut self.stream)?;
        if answer["evt"] == "ERROR" {
            // Refused, e.g. a field Discord does not take: the log says why.
            log_error!("Discord refused the status: {}", answer["data"]["message"]);
        }
        Ok(())
    }
}

/// What the worker is told.
enum Command {
    Set(Option<Activity>),
}

pub struct Discord {
    sender: Mutex<Option<Sender<Command>>>,
    /// The status last asked for, for the preview in the settings window.
    last: Mutex<Option<Activity>>,
}

impl Default for Discord {
    fn default() -> Self {
        Self {
            sender: Mutex::new(None),
            last: Mutex::new(None),
        }
    }
}

impl Discord {
    /// What Discord was last asked to show, or `None`.
    pub fn last(&self) -> Option<Activity> {
        self.last
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .clone()
    }

    /// Shows `activity`, or nothing with `None`. The worker starts on first use.
    pub fn set(&self, activity: Option<Activity>) {
        *self.last.lock().unwrap_or_else(|err| err.into_inner()) = activity.clone();
        if CLIENT_ID.is_empty() {
            return;
        }
        let mut sender = self.sender.lock().unwrap_or_else(|err| err.into_inner());
        let send = |sender: &Sender<Command>| sender.send(Command::Set(activity.clone())).is_ok();
        if sender.as_ref().is_some_and(send) {
            return;
        }
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || work(rx));
        send(&tx);
        *sender = Some(tx);
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis() as u64)
        .unwrap_or(0)
}

/// Keeps Discord showing the newest status: sends it when the last send is
/// long enough ago, and connects again after Discord was gone.
fn work(commands: Receiver<Command>) {
    // What Discord should show, and whether it does already.
    let mut wanted: Option<Activity> = None;
    let mut shown = true;
    let mut connection: Option<Connection> = None;
    let mut last_send: Option<Instant> = None;
    let mut last_attempt: Option<Instant> = None;
    loop {
        let until = |last: Option<Instant>, interval: Duration| {
            interval.saturating_sub(last.map_or(interval, |at| at.elapsed()))
        };
        let wait = if shown && wanted.is_some() {
            until(last_send, HEARTBEAT)
        } else if shown {
            Duration::from_secs(3600)
        } else if connection.is_none() {
            until(last_attempt, RETRY_INTERVAL)
        } else {
            until(last_send, MIN_INTERVAL)
        }
        .max(Duration::from_millis(200));
        match commands.recv_timeout(wait) {
            Ok(Command::Set(activity)) => {
                shown = shown && activity == wanted;
                wanted = activity;
                // Take every waiting command; only the newest counts.
                while let Ok(Command::Set(activity)) = commands.try_recv() {
                    shown = shown && activity == wanted;
                    wanted = activity;
                }
                if shown {
                    continue;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                // Send the status again now and then: after Discord was
                // restarted, this brings it back without waiting for a change.
                if shown
                    && wanted.is_some()
                    && last_send.is_some_and(|at| at.elapsed() >= HEARTBEAT)
                {
                    shown = false;
                }
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
        if shown || last_send.is_some_and(|at| at.elapsed() < MIN_INTERVAL) {
            continue;
        }
        if connection.is_none() {
            if wanted.is_none() {
                // Nothing to show and nothing shown: no need to look for Discord.
                shown = true;
                continue;
            }
            if last_attempt.is_some_and(|at| at.elapsed() < RETRY_INTERVAL) {
                continue;
            }
            last_attempt = Some(Instant::now());
            connection = Connection::open();
        }
        if let Some(open) = connection.as_mut() {
            last_send = Some(Instant::now());
            if open.set(wanted.as_ref()).is_ok() {
                shown = true;
            } else {
                // Discord went away; try again later.
                connection = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000_000;

    fn request() -> ActivityRequest {
        ActivityRequest {
            title: "Never Gonna Give You Up".into(),
            artist: "Rick Astley".into(),
            album: "Whenever You Need Somebody".into(),
            cover_url: Some("https://lh3.googleusercontent.com/abc=w544-h544".into()),
            start_ms: Some(NOW - 30_000),
            end_ms: Some(NOW + 180_000),
            video_id: Some("dQw4w9WgXcQ".into()),
            paused: false,
            display: "artist".into(),
            show_cover: true,
            show_progress: true,
            show_links: true,
            small_text: Some("ytmusic-desktop".into()),
            listen_label: Some("Anhören".into()),
            app_label: Some("Hol dir die App".into()),
        }
    }

    #[test]
    fn a_track_becomes_a_listening_activity() {
        let activity = serde_json::to_value(check(&request(), NOW)).unwrap();
        assert_eq!(
            activity,
            json!({
                "type": 2,
                "status_display_type": 1,
                "details": "Never Gonna Give You Up",
                "details_url": "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
                "state": "Rick Astley",
                "state_url": "https://music.youtube.com/search?q=Rick+Astley",
                "timestamps": { "start": NOW - 30_000, "end": NOW + 180_000 },
                "assets": {
                    "large_image": "https://lh3.googleusercontent.com/abc=w544-h544",
                    "large_text": "Whenever You Need Somebody",
                    "small_image": APP_ICON_URL,
                    "small_text": "ytmusic-desktop"
                },
                "buttons": [
                    { "label": "Anhören", "url": "https://music.youtube.com/watch?v=dQw4w9WgXcQ" },
                    { "label": "Hol dir die App", "url": REPOSITORY }
                ]
            })
        );
    }

    #[test]
    fn the_settings_leave_parts_out() {
        let mut plain = request();
        plain.display = "app".into();
        plain.show_cover = false;
        plain.show_progress = false;
        plain.show_links = false;
        plain.small_text = None;
        plain.listen_label = None;
        plain.app_label = None;
        let activity = serde_json::to_value(check(&plain, NOW)).unwrap();
        assert_eq!(
            activity,
            json!({
                "type": 2,
                "status_display_type": 0,
                "details": "Never Gonna Give You Up",
                "state": "Rick Astley",
                "assets": { "large_text": "Whenever You Need Somebody" }
            })
        );

        let mut paused = request();
        paused.paused = true;
        assert_eq!(check(&paused, NOW).timestamps, None);
        paused.display = "title".into();
        assert_eq!(check(&paused, NOW).status_display_type, 2);
    }

    #[test]
    fn what_the_page_sends_is_checked() {
        let mut odd = request();
        odd.title = "x".repeat(500);
        odd.artist = "A&B=C".into();
        odd.album = "  ".into();
        odd.cover_url = Some("http://example.com/cover.jpg".into());
        odd.start_ms = Some(5);
        odd.end_ms = Some(NOW);
        odd.video_id = Some("\"><script>".into());
        odd.listen_label = Some("a very long label that Discord would refuse".into());
        odd.app_label = Some("   ".into());
        let activity = check(&odd, NOW);
        assert_eq!(activity.details.chars().count(), MAX_TEXT_CHARS);
        assert_eq!(activity.details_url, None);
        assert_eq!(
            activity.state_url.as_deref(),
            Some("https://music.youtube.com/search?q=A%26B%3DC")
        );
        assert_eq!(activity.assets.large_image, None);
        assert_eq!(activity.assets.large_text, None);
        assert_eq!(activity.timestamps, None);
        // No track id: no listen button; an empty label: no app button.
        assert!(activity.buttons.is_empty());

        let mut no_end = request();
        no_end.end_ms = Some(NOW - 60_000);
        assert_eq!(
            check(&no_end, NOW).timestamps,
            Some(Timestamps {
                start: NOW - 30_000,
                end: None
            })
        );
        assert_eq!(
            label(Some(&"x".repeat(40))).map(|l| l.chars().count()),
            Some(32)
        );
    }

    #[test]
    fn the_last_status_is_kept_for_the_preview() {
        let discord = Discord::default();
        assert_eq!(discord.last(), None);
        let activity = check(&request(), NOW);
        *discord.last.lock().unwrap() = Some(activity.clone());
        assert_eq!(discord.last(), Some(activity));
    }

    #[test]
    fn frames_have_opcode_and_length_in_front() {
        let frame = encode(OP_FRAME, &json!({ "a": 1 }));
        assert_eq!(&frame[..8], &[1, 0, 0, 0, 7, 0, 0, 0]);
        let (op, value) = read_frame(&mut frame.as_slice()).unwrap();
        assert_eq!((op, value), (OP_FRAME, json!({ "a": 1 })));

        let mut huge = Vec::from(1u32.to_le_bytes());
        huge.extend_from_slice(&(MAX_FRAME_BYTES + 1).to_le_bytes());
        assert!(read_frame(&mut huge.as_slice()).is_err());
    }
}

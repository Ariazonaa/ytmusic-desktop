//! Listening statistics, kept on this computer only: how often and how long
//! each track and artist was heard, and the listening time of each day. The
//! page reports what was heard; nothing leaves the computer.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};

const FILE: &str = "stats.json";
/// Heard this long, a track counts as played.
pub const PLAY_SECONDS: u32 = 30;
const MAX_TRACKS: usize = 5000;
const MAX_ARTISTS: usize = 2000;
const MAX_DAYS: usize = 400;
const MAX_TEXT_CHARS: usize = 200;
/// More than this at once is not one track heard.
const MAX_REPORT_SECONDS: u32 = 6 * 60 * 60;
const TOP: usize = 20;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Counts {
    pub plays: u32,
    pub seconds: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TrackCounts {
    pub title: String,
    pub artist: String,
    #[serde(flatten)]
    pub counts: Counts,
}

/// What is kept on disk.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Stats {
    /// By video id.
    pub tracks: BTreeMap<String, TrackCounts>,
    /// By artist as YouTube Music names them.
    pub artists: BTreeMap<String, Counts>,
    /// Seconds heard by day, `YYYY-MM-DD` in local time as the page says it.
    pub days: BTreeMap<String, u64>,
}

/// What the panel shows.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub top_tracks: Vec<TrackCounts>,
    pub top_artists: Vec<(String, Counts)>,
    pub days: Vec<(String, u64)>,
    pub total_seconds: u64,
    pub total_plays: u64,
}

/// One heard stretch of a track, as the page reports it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Heard {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    /// Seconds heard of the track this time. From `PLAY_SECONDS` on, it counts as a play.
    pub seconds: u32,
    /// The local day, `YYYY-MM-DD`.
    pub day: String,
}

fn text(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_TEXT_CHARS)
        .collect()
}

fn valid_day(day: &str) -> bool {
    let bytes = day.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                *b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
}

fn valid_video_id(id: &str) -> bool {
    (6..=20).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

impl Stats {
    pub fn add(&mut self, heard: &Heard) -> Result<(), String> {
        if !valid_video_id(&heard.video_id) {
            return Err("not a video id".into());
        }
        if !valid_day(&heard.day) {
            return Err("not a day".into());
        }
        let seconds = u64::from(heard.seconds.min(MAX_REPORT_SECONDS));
        let plays = u32::from(heard.seconds >= PLAY_SECONDS);
        let track = self.tracks.entry(heard.video_id.clone()).or_default();
        track.title = text(&heard.title);
        track.artist = text(&heard.artist);
        track.counts.plays += plays;
        track.counts.seconds += seconds;
        let artist = text(&heard.artist);
        if !artist.is_empty() {
            let counts = self.artists.entry(artist).or_default();
            counts.plays += plays;
            counts.seconds += seconds;
        }
        *self.days.entry(heard.day.clone()).or_default() += seconds;
        self.trim();
        Ok(())
    }

    /// Forgets the least heard tracks and artists and the oldest days beyond the limits.
    fn trim(&mut self) {
        if self.tracks.len() > MAX_TRACKS {
            let mut ids: Vec<(u64, String)> = self
                .tracks
                .iter()
                .map(|(id, t)| (t.counts.seconds, id.clone()))
                .collect();
            ids.sort();
            for (_, id) in ids.into_iter().take(self.tracks.len() - MAX_TRACKS) {
                self.tracks.remove(&id);
            }
        }
        if self.artists.len() > MAX_ARTISTS {
            let mut names: Vec<(u64, String)> = self
                .artists
                .iter()
                .map(|(n, c)| (c.seconds, n.clone()))
                .collect();
            names.sort();
            for (_, name) in names.into_iter().take(self.artists.len() - MAX_ARTISTS) {
                self.artists.remove(&name);
            }
        }
        while self.days.len() > MAX_DAYS {
            let oldest = self.days.keys().next().cloned().unwrap_or_default();
            self.days.remove(&oldest);
        }
    }

    /// The most heard tracks and artists, by plays then time, and the last `days` days.
    pub fn summary(&self, days: usize) -> Summary {
        let mut top_tracks: Vec<TrackCounts> = self.tracks.values().cloned().collect();
        top_tracks.sort_by(|a, b| {
            (b.counts.plays, b.counts.seconds).cmp(&(a.counts.plays, a.counts.seconds))
        });
        top_tracks.truncate(TOP);
        let mut top_artists: Vec<(String, Counts)> = self
            .artists
            .iter()
            .map(|(n, c)| (n.clone(), c.clone()))
            .collect();
        top_artists.sort_by_key(|a| std::cmp::Reverse((a.1.plays, a.1.seconds)));
        top_artists.truncate(TOP);
        let recent: Vec<(String, u64)> = self
            .days
            .iter()
            .rev()
            .take(days)
            .map(|(d, s)| (d.clone(), *s))
            .collect();
        Summary {
            top_tracks,
            top_artists,
            days: recent.into_iter().rev().collect(),
            total_seconds: self.days.values().sum(),
            total_plays: self
                .tracks
                .values()
                .map(|t| u64::from(t.counts.plays))
                .sum(),
        }
    }
}

pub fn path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    Some(crate::portable::config_dir(app).ok()?.join(FILE))
}

pub fn load(path: &Path) -> Stats {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, stats: &Stats) -> Result<(), String> {
    let bytes = serde_json::to_vec(stats).map_err(|err| err.to_string())?;
    let partial = path.with_extension("json.partial");
    fs::write(&partial, bytes).map_err(|err| err.to_string())?;
    fs::rename(&partial, path).map_err(|err| err.to_string())
}

/// The statistics in memory, loaded on first use; every change is saved.
#[derive(Default)]
pub struct StatsStore(Mutex<Option<Stats>>);

impl StatsStore {
    pub fn with<T>(
        &self,
        path: &Path,
        change: impl FnOnce(&mut Stats) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self.0.lock().unwrap_or_else(|err| err.into_inner());
        let stats = guard.get_or_insert_with(|| load(path));
        let result = change(stats)?;
        save(path, stats)?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn heard(id: &str, artist: &str, seconds: u32, day: &str) -> Heard {
        Heard {
            video_id: id.into(),
            title: format!("Title {id}"),
            artist: artist.into(),
            seconds,
            day: day.into(),
        }
    }

    #[test]
    fn counts_plays_time_and_days() {
        let mut stats = Stats::default();
        stats
            .add(&heard("aaaaaaaaaaa", "Maroon 5", 200, "2026-10-16"))
            .unwrap();
        stats
            .add(&heard("aaaaaaaaaaa", "Maroon 5", 180, "2026-10-17"))
            .unwrap();
        stats
            .add(&heard("bbbbbbbbbbb", "Abba", 10, "2026-10-17"))
            .unwrap();
        let summary = stats.summary(30);
        assert_eq!(summary.top_tracks[0].title, "Title aaaaaaaaaaa");
        assert_eq!(
            summary.top_tracks[0].counts,
            Counts {
                plays: 2,
                seconds: 380
            }
        );
        // Heard for a moment only: time, but no play.
        assert_eq!(summary.top_tracks[1].counts.plays, 0);
        assert_eq!(summary.top_artists[0].0, "Maroon 5");
        assert_eq!(
            summary.days,
            vec![
                ("2026-10-16".to_string(), 200),
                ("2026-10-17".to_string(), 190)
            ]
        );
        assert_eq!((summary.total_seconds, summary.total_plays), (390, 2));
    }

    #[test]
    fn refuses_what_is_not_a_report() {
        let mut stats = Stats::default();
        assert!(stats.add(&heard("../x", "A", 60, "2026-10-17")).is_err());
        assert!(stats
            .add(&heard("aaaaaaaaaaa", "A", 60, "17.10.2026"))
            .is_err());
        stats
            .add(&heard("aaaaaaaaaaa", "A", u32::MAX, "2026-10-17"))
            .unwrap();
        assert_eq!(stats.days["2026-10-17"], u64::from(MAX_REPORT_SECONDS));
    }

    #[test]
    fn stays_bounded() {
        let mut stats = Stats::default();
        for day in 0..(MAX_DAYS + 5) {
            let date = format!("{}-01-01", 1500 + day);
            stats.days.insert(date, 1);
        }
        stats
            .add(&heard("aaaaaaaaaaa", "A", 60, "2026-12-31"))
            .unwrap();
        assert_eq!(stats.days.len(), MAX_DAYS);
        assert!(stats.days.contains_key("2026-12-31"));
    }

    #[test]
    fn saves_and_loads() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(FILE);
        let store = StatsStore::default();
        store
            .with(&file, |stats| {
                stats.add(&heard("aaaaaaaaaaa", "A", 60, "2026-10-17"))
            })
            .unwrap();
        assert_eq!(load(&file).tracks.len(), 1);
        fs::write(&file, "{ broken").unwrap();
        assert_eq!(load(&file), Stats::default());
    }
}

//! A log file for errors, `log.txt` in the app config directory, so that a
//! release build without a console still leaves a trace.
//!
//! The YouTube Music page may add lines too, which makes the file a place a
//! misbehaving page could fill. Its lines are cut short and counted, and the
//! file is started over once it has grown large.

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_FILE_BYTES: u64 = 512 * 1024;
const MAX_LINE_CHARS: usize = 2000;
/// How many lines the page may write per run of the app.
const MAX_PAGE_LINES: u32 = 200;

struct Log {
    path: PathBuf,
    page_lines: u32,
}

static LOG: OnceLock<Mutex<Log>> = OnceLock::new();

/// Writes an error to the console and to the log file.
macro_rules! log_error {
    ($($arg:tt)*) => {
        $crate::log::error("app", &format!($($arg)*))
    };
}

/// Chooses the log file. A file that has grown large is kept as `log.old.txt`
/// and a new one is started.
pub fn init(dir: &Path) {
    let path = dir.join("log.txt");
    if fs::metadata(&path).is_ok_and(|meta| meta.len() > MAX_FILE_BYTES) {
        let _ = fs::rename(&path, dir.join("log.old.txt"));
    }
    let _ = LOG.set(Mutex::new(Log {
        path,
        page_lines: 0,
    }));
}

/// The log file, once `init` has run.
pub fn path() -> Option<PathBuf> {
    Some(lock()?.path.clone())
}

pub fn error(source: &str, message: &str) {
    eprintln!("{message}");
    if let Some(log) = lock() {
        append(&log.path, source, message);
    }
}

/// A line from the YouTube Music page. Returns whether it was written.
pub fn page_error(message: &str) -> bool {
    let Some(mut log) = lock() else {
        return false;
    };
    if log.page_lines >= MAX_PAGE_LINES {
        return false;
    }
    log.page_lines += 1;
    append(&log.path, "page", message);
    if log.page_lines == MAX_PAGE_LINES {
        append(&log.path, "app", "no more lines from the page in this run");
    }
    true
}

fn lock() -> Option<std::sync::MutexGuard<'static, Log>> {
    Some(LOG.get()?.lock().unwrap_or_else(|err| err.into_inner()))
}

fn append(path: &Path, source: &str, message: &str) {
    let line = format_line(now(), source, message);
    // Not only at start: the app may run for weeks.
    if fs::metadata(path).is_ok_and(|meta| meta.len() > MAX_FILE_BYTES) {
        let _ = fs::rename(path, path.with_file_name("log.old.txt"));
    }
    let written = path
        .parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| OpenOptions::new().create(true).append(true).open(path))
        .and_then(|mut file| file.write_all(line.as_bytes()));
    if let Err(err) = written {
        eprintln!("cannot write to the log file: {err}");
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// One line per message: a message cannot fake further entries with line
/// breaks, and its length is bounded.
fn format_line(unix_seconds: u64, source: &str, message: &str) -> String {
    let text: String = message
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(MAX_LINE_CHARS)
        .collect();
    format!("{} [{source}] {}\n", timestamp(unix_seconds), text.trim())
}

/// `2026-10-07 12:34:56Z` for seconds since 1970, in UTC.
fn timestamp(unix_seconds: u64) -> String {
    let days = unix_seconds / 86_400;
    let rest = unix_seconds % 86_400;
    // Civil date from a day count, after Howard Hinnant's `civil_from_days`.
    let z = days + 719_468;
    let era = z / 146_097;
    let day_of_era = z % 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + u64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_timestamps_in_utc() {
        assert_eq!(timestamp(0), "1970-01-01 00:00:00Z");
        assert_eq!(timestamp(951_782_400), "2000-02-29 00:00:00Z");
        assert_eq!(timestamp(1_791_376_496), "2026-10-07 12:34:56Z");
        assert_eq!(timestamp(1_798_761_599), "2026-12-31 23:59:59Z");
    }

    #[test]
    fn a_message_stays_on_one_bounded_line() {
        let line = format_line(0, "page", "first\nsecond\r\n\tthird  ");
        assert_eq!(line, "1970-01-01 00:00:00Z [page] first second   third\n");
        let long = format_line(0, "page", &"x".repeat(5000));
        assert_eq!(long.trim_end().chars().filter(|c| *c == 'x').count(), 2000);
        assert_eq!(long.matches('\n').count(), 1);
    }

    #[test]
    fn appends_lines_to_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("log.txt");
        append(&path, "app", "one");
        append(&path, "page", "two");
        let text = fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("[app] one"));
        assert!(lines[1].ends_with("[page] two"));
    }
}

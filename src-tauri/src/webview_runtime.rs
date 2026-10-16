//! Finds WebView2 where Windows has it but did not register it, as in Windows
//! Sandbox: the runtime's files come with Windows 11, but the loader looks
//! only where EdgeUpdate registered them and finds nothing, so no window
//! could open.
// Only Windows uses it; the tests run everywhere.
#![cfg_attr(not(windows), allow(dead_code))]

use std::path::{Path, PathBuf};

const VARIABLE: &str = "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER";
const EXECUTABLE: &str = "msedgewebview2.exe";

/// Points the loader to the runtime's folder if it would find none itself.
/// Must run before the first window, and before other threads start.
#[cfg(windows)]
pub fn use_unregistered_runtime() {
    if std::env::var_os(VARIABLE).is_some() || registered() {
        return;
    }
    let program_files = std::env::var_os("ProgramFiles(x86)")
        .or_else(|| std::env::var_os("ProgramFiles"))
        .map(PathBuf::from);
    if let Some(folder) = program_files.and_then(|dir| newest_runtime(&dir)) {
        std::env::set_var(VARIABLE, folder);
    }
}

/// Whether the loader finds an installed runtime.
#[cfg(windows)]
fn registered() -> bool {
    use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
    use windows_core::{PCWSTR, PWSTR};

    let mut version = PWSTR::null();
    // SAFETY: `version` receives a string the call allocates; `take_pwstr`
    // frees it.
    let found =
        unsafe { GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut version) };
    found.is_ok() && !webview2_com::take_pwstr(version).is_empty()
}

/// The folder of the newest runtime under `program_files`, in
/// `Microsoft\EdgeWebView\Application\<version>`.
fn newest_runtime(program_files: &Path) -> Option<PathBuf> {
    let application = program_files
        .join("Microsoft")
        .join("EdgeWebView")
        .join("Application");
    std::fs::read_dir(application)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let version = parse_version(entry.file_name().to_str()?)?;
            let folder = entry.path();
            folder
                .join(EXECUTABLE)
                .is_file()
                .then_some((version, folder))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, folder)| folder)
}

fn parse_version(name: &str) -> Option<Vec<u32>> {
    let parts: Option<Vec<u32>> = name.split('.').map(|part| part.parse().ok()).collect();
    parts.filter(|parts| parts.len() == 4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_the_newest_complete_runtime() {
        let dir = tempfile::tempdir().unwrap();
        let application = dir.path().join("Microsoft/EdgeWebView/Application");
        for (version, complete) in [
            ("154.0.4258.62", true),
            ("155.0.4283.45", true),
            // Newer, but without the executable: an update being installed.
            ("156.0.1.1", false),
            ("SetupMetrics", true),
        ] {
            let folder = application.join(version);
            fs::create_dir_all(&folder).unwrap();
            if complete {
                fs::write(folder.join(EXECUTABLE), "").unwrap();
            }
        }
        assert_eq!(
            newest_runtime(dir.path()),
            Some(application.join("155.0.4283.45"))
        );
    }

    #[test]
    fn finds_nothing_without_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(newest_runtime(dir.path()), None);
    }

    #[test]
    fn compares_versions_as_numbers() {
        assert!(parse_version("155.0.4283.45") > parse_version("99.0.9999.99"));
        assert_eq!(parse_version("155.0"), None);
        assert_eq!(parse_version("PlatformExperiencesHelper"), None);
    }
}

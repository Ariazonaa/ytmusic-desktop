//! Development builds only: loads the injected script from disk instead of
//! embedding it, and reloads the page when the script is rebuilt. Also
//! reloads the external plugins when the script for their sandbox is rebuilt.
//!
//! The script is registered with WebView2 directly, so it still runs before
//! the page's own scripts, exactly as the embedded one does in a release build.

use std::{fs, path::PathBuf, sync::Mutex, thread, time::Duration};
use tauri::{Manager, WebviewWindow};
use webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler;
use windows_core::HSTRING;

/// WebView2's id of the registered script, needed to replace it.
static SCRIPT_ID: Mutex<Option<String>> = Mutex::new(None);

const POLL: Duration = Duration::from_millis(500);

fn bundle_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../dist-inject")
        .join(name)
}

/// Calls `on_change` with the new contents whenever the file at `path`
/// changes from `current`.
fn watch(path: PathBuf, mut current: String, on_change: impl Fn(&str) + Send + 'static) {
    thread::spawn(move || {
        // A rebuild writes the file in steps. A change counts once two reads
        // in a row agree, so a half-written script is never used.
        let mut candidate = current.clone();
        loop {
            thread::sleep(POLL);
            let Ok(script) = fs::read_to_string(&path) else {
                continue;
            };
            if script.is_empty() || script == current {
                candidate.clone_from(&current);
            } else if script != candidate {
                candidate = script;
            } else {
                current = script;
                on_change(&current);
            }
        }
    });
}

/// What to do once the new script is registered.
enum Then {
    Navigate(String),
    Reload,
}

/// Replaces the registered script with `script`.
fn install(window: &WebviewWindow, script: String, then: Then) {
    let result = window.with_webview(move |webview| {
        // SAFETY: plain COM calls on the live webview, made on the thread that
        // owns it, which is where `with_webview` runs this.
        let installed = unsafe {
            webview.controller().CoreWebView2().and_then(|core| {
                let previous = SCRIPT_ID.lock().ok().and_then(|mut id| id.take());
                if let Some(previous) = previous {
                    core.RemoveScriptToExecuteOnDocumentCreated(&HSTRING::from(previous))?;
                }
                let registered = core.clone();
                let handler = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(
                    Box::new(move |outcome, id| {
                        outcome?;
                        if let Ok(mut current) = SCRIPT_ID.lock() {
                            *current = Some(id);
                        }
                        match then {
                            Then::Navigate(url) => registered.Navigate(&HSTRING::from(url)),
                            Then::Reload => registered.Reload(),
                        }
                    }),
                );
                core.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(script), &handler)
            })
        };
        if let Err(err) = installed {
            log_error!("[dev] cannot register the injected script: {err}");
        }
    });
    if let Err(err) = result {
        log_error!("[dev] cannot reach the webview: {err}");
    }
}

/// Registers the script from disk, opens `url` and keeps watching the
/// built scripts. The window must not have navigated to `url` yet.
pub fn start(window: &WebviewWindow, url: &str) {
    let read = |path: &PathBuf| {
        fs::read_to_string(path).unwrap_or_else(|err| {
            log_error!("[dev] cannot read {}: {err}", path.display());
            String::new()
        })
    };

    let inject = bundle_path("inject.js");
    let script = read(&inject);
    install(window, script.clone(), Then::Navigate(url.into()));
    let page = window.clone();
    watch(inject, script, move |script| {
        println!("[dev] injected script changed, reloading the page");
        install(&page, script.to_owned(), Then::Reload);
    });

    // The sandbox script is read from disk on every request (`plugins::bootstrap`),
    // so the plugins only need to be started again.
    let sandbox = bundle_path("sandbox.js");
    let app = window.app_handle().clone();
    watch(sandbox.clone(), read(&sandbox), move |_| {
        println!("[dev] sandbox script changed, reloading the external plugins");
        crate::window::reload_plugins(&app);
    });
}

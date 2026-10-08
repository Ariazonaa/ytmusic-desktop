//! Saves memory while the main window is hidden in the tray.
//!
//! Hiding the window alone leaves WebView2 rendering the page as if it were
//! on screen. Telling it that the view is invisible stops that, and the low
//! memory target makes it give back what it can. Audio keeps playing.

use tauri::WebviewWindow;

#[cfg(windows)]
pub fn set_hidden(window: &WebviewWindow, hidden: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows_core::Interface;

    let result = window.with_webview(move |webview| {
        let controller = webview.controller();
        let level = if hidden {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        // SAFETY: plain COM calls on the controller of a live webview, made on
        // the thread that owns it, which is where `with_webview` runs this.
        let applied = unsafe {
            controller.SetIsVisible(!hidden).and_then(|()| {
                controller
                    .CoreWebView2()?
                    .cast::<ICoreWebView2_19>()?
                    .SetMemoryUsageTargetLevel(level)
            })
        };
        if let Err(err) = applied {
            log_error!("cannot switch the webview's background mode: {err}");
        }
    });
    if let Err(err) = result {
        log_error!("cannot reach the webview: {err}");
    }
}

#[cfg(not(windows))]
pub fn set_hidden(_window: &WebviewWindow, _hidden: bool) {}

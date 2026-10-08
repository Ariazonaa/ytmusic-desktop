//! A page of the app's own for when YouTube Music cannot be reached, in
//! place of the browser's error page: it says what is wrong, offers to try
//! again and goes back to YouTube Music by itself once there is a connection.

use tauri::WebviewWindow;

/// The page, in English and German. It picks German when `language` says so,
/// or when it says `system` and the browser reports a German system.
/// `target` is where it goes when the connection is back.
pub fn page(language: &str, target: &str) -> String {
    // Only these three are settings; anything else follows the system.
    let forced = match language {
        "en" | "de" => language,
        _ => "",
    };
    PAGE.replace("__FORCED__", forced)
        .replace("__TARGET__", target)
}

// The page has no way to reach the app: it only loads `__TARGET__` again.
// Asking for a small file without reading the answer tells whether the site
// can be reached; a page from nowhere may do that, but not read what comes back.
const PAGE: &str = r#"<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>YouTube Music</title>
<style>
  html { color-scheme: dark; }
  body {
    margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #030303; color: #fff; font: 15px/1.5 Roboto, "Segoe UI", Arial, sans-serif;
  }
  main { max-width: 420px; padding: 24px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 22px; font-weight: 500; }
  p { margin: 0 0 20px; color: rgba(255, 255, 255, 0.7); }
  button {
    padding: 9px 22px; border: 0; border-radius: 18px; background: #fff; color: #030303;
    font: inherit; font-weight: 500; cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  small { display: block; margin-top: 16px; color: rgba(255, 255, 255, 0.45); }
</style>
<main>
  <h1 id="title"></h1>
  <p id="text"></p>
  <button id="retry" type="button"></button>
  <small id="status" role="status"></small>
</main>
<script>
  const TARGET = "__TARGET__";
  const TEXTS = {
    en: {
      title: "No connection",
      text: "YouTube Music cannot be reached. The app goes back to it by itself as soon as there is a connection.",
      retry: "Try again",
      checking: "Checking…",
      still: "Still no connection.",
    },
    de: {
      title: "Keine Verbindung",
      text: "YouTube Music ist nicht erreichbar. Die App kehrt von selbst dorthin zurück, sobald es eine Verbindung gibt.",
      retry: "Erneut versuchen",
      checking: "Prüfe…",
      still: "Weiterhin keine Verbindung.",
    },
  };
  const language = "__FORCED__" || (navigator.language.toLowerCase().startsWith("de") ? "de" : "en");
  const t = TEXTS[language];
  document.documentElement.lang = language;
  for (const id of ["title", "text", "retry"]) document.getElementById(id).textContent = t[id];
  const button = document.getElementById("retry");
  const status = document.getElementById("status");

  async function reachable() {
    try {
      await fetch(TARGET + "/favicon.ico", { mode: "no-cors", cache: "no-store" });
      return true;
    } catch {
      return false;
    }
  }
  async function check(byHand) {
    if (byHand) {
      button.disabled = true;
      status.textContent = t.checking;
    }
    if (await reachable()) {
      location.replace(TARGET);
      return;
    }
    if (byHand) {
      button.disabled = false;
      status.textContent = t.still;
    }
  }
  button.addEventListener("click", () => check(true));
  addEventListener("online", () => check(false));
  setInterval(() => check(false), 5000);
</script>
</html>
"#;

/// Shows the page whenever the window ends up on the browser's error page
/// because a page could not be loaded. `language` is asked each time, so a
/// changed setting applies.
#[cfg(windows)]
pub fn watch(
    window: &WebviewWindow,
    target: &'static str,
    language: impl Fn() -> String + Send + Sync + 'static,
) {
    use std::sync::Arc;
    use webview2_com::{
        ExecuteScriptCompletedHandler,
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_WEB_ERROR_STATUS,
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT,
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED,
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED,
            COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS,
            COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
            COREWEBVIEW2_WEB_ERROR_STATUS_VALID_AUTHENTICATION_CREDENTIALS_REQUIRED,
            COREWEBVIEW2_WEB_ERROR_STATUS_VALID_PROXY_AUTHENTICATION_REQUIRED,
        },
        NavigationCompletedEventHandler,
    };
    use windows_core::{BOOL, HSTRING};

    // Failures that are not about reaching the site: a load that was
    // cancelled, a certificate the browser does not trust, a login a proxy
    // asks for. The browser's own page says more about those than ours would.
    const NOT_OURS: [COREWEBVIEW2_WEB_ERROR_STATUS; 8] = [
        COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS,
        COREWEBVIEW2_WEB_ERROR_STATUS_VALID_AUTHENTICATION_CREDENTIALS_REQUIRED,
        COREWEBVIEW2_WEB_ERROR_STATUS_VALID_PROXY_AUTHENTICATION_REQUIRED,
    ];
    // What the browser's error page gives as the first part of its address.
    const ERROR_PAGE: &str = "\"chrome-error:\"";

    let language = Arc::new(language);
    let result = window.with_webview(move |webview| {
        let handler = NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
            let (Some(sender), Some(args)) = (sender, args) else {
                return Ok(());
            };
            let mut success = BOOL::default();
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
            // SAFETY: plain COM calls on the arguments of a live event, with
            // valid places for the results, on the thread that raised it.
            unsafe {
                args.IsSuccess(&mut success)?;
                args.WebErrorStatus(&mut status)?;
            }
            if success.as_bool() || NOT_OURS.contains(&status) {
                return Ok(());
            }
            // A failed load does not always leave an error page: one that was
            // overtaken by another load leaves the page as it was, music and
            // all. So the page is only replaced if it is the error page.
            let page_webview = sender.clone();
            let language = Arc::clone(&language);
            let on_answer =
                ExecuteScriptCompletedHandler::create(Box::new(move |outcome, protocol| {
                    outcome?;
                    if protocol != ERROR_PAGE {
                        return Ok(());
                    }
                    let html = page(&language(), target);
                    // SAFETY: a COM call on a live webview, on its own thread.
                    unsafe { page_webview.NavigateToString(&HSTRING::from(html)) }
                }));
            // SAFETY: a COM call on the webview that raised the event.
            unsafe { sender.ExecuteScript(&HSTRING::from("location.protocol"), &on_answer) }
        }));
        let mut token = 0i64;
        // SAFETY: a COM call on the controller of a live webview, made on the
        // thread that owns it, which is where `with_webview` runs this.
        let registered = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.add_NavigationCompleted(&handler, &mut token))
        };
        if let Err(err) = registered {
            log_error!("cannot watch for failed page loads: {err}");
        }
    });
    if let Err(err) = result {
        log_error!("cannot reach the webview: {err}");
    }
}

/// Other systems show their webview's own error page for now.
#[cfg(not(windows))]
pub fn watch(
    _window: &WebviewWindow,
    target: &'static str,
    language: impl Fn() -> String + Send + Sync + 'static,
) {
    // Built here so that the page counts as used on these systems too.
    let _ = page(&language(), target);
}

#[cfg(test)]
mod tests {
    use super::*;

    const TARGET: &str = "https://music.youtube.com";

    #[test]
    fn has_both_languages_and_a_way_back() {
        let html = page("system", TARGET);
        assert!(html.contains("Try again"));
        assert!(html.contains("Erneut versuchen"));
        assert!(html.contains(r#"const TARGET = "https://music.youtube.com";"#));
        assert!(!html.contains("__TARGET__"));
        assert!(!html.contains("__FORCED__"));
    }

    #[test]
    fn follows_the_language_setting() {
        assert!(page("de", TARGET).contains(r#"const language = "de" ||"#));
        assert!(page("en", TARGET).contains(r#"const language = "en" ||"#));
        assert!(page("system", TARGET).contains(r#"const language = "" ||"#));
        // A value that is not a setting cannot put anything into the page.
        assert!(page("\"; alert(1); \"", TARGET).contains(r#"const language = "" ||"#));
    }

    #[test]
    fn reaches_nothing_but_the_target() {
        let html = page("system", TARGET);
        assert_eq!(html.matches("https://").count(), 1);
        assert!(!html.contains("__TAURI"));
        assert!(!html.contains("invoke"));
    }
}

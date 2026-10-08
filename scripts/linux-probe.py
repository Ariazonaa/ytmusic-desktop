#!/usr/bin/env python3
"""Loads YouTube Music in WebKitGTK, the webview Tauri uses on Linux, and
reports what playback needs: media source, codecs, key systems, and whether
a track actually plays. Run under a display, e.g. `xvfb-run -a python3 scripts/linux-probe.py`.
"""
import json
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
gi.require_version("Soup", "3.0")
from gi.repository import GLib, Gtk, Soup, WebKit2  # noqa: E402

URL = "https://music.youtube.com/watch?v=dQw4w9WgXcQ"
# What Chrome on Linux sends; YouTube Music turns unknown browsers away.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/140.0.0.0 Safari/537.36"
)

PROBE = """
const keySystem = async (name) => {
  if (!navigator.requestMediaKeySystemAccess) return "no EME API";
  const config = [{ initDataTypes: ["cenc"], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] }];
  try { await navigator.requestMediaKeySystemAccess(name, config); return "available"; }
  catch (error) { return "unavailable: " + error.name; }
};
const supports = (type) => (window.MediaSource ? MediaSource.isTypeSupported(type) : false);
const video = document.querySelector("video");
if (video && video.paused) { try { await video.play(); } catch (error) { window.__playError = String(error); } }
await new Promise((done) => setTimeout(done, 8000));
const player = document.querySelector("#movie_player");
return JSON.stringify({
  location: location.href,
  title: document.title,
  userAgent: navigator.userAgent,
  mediaSource: Boolean(window.MediaSource),
  managedMediaSource: Boolean(window.ManagedMediaSource),
  aac: supports('audio/mp4; codecs="mp4a.40.2"'),
  opus: supports('audio/webm; codecs="opus"'),
  h264: supports('video/mp4; codecs="avc1.4d401f"'),
  vp9: supports('video/webm; codecs="vp09.00.31.08"'),
  widevine: await keySystem("com.widevine.alpha"),
  clearkey: await keySystem("org.w3.clearkey"),
  hasVideoElement: Boolean(video),
  paused: video ? video.paused : null,
  currentTime: video ? video.currentTime : null,
  readyState: video ? video.readyState : null,
  mediaError: video && video.error ? video.error.code + " " + video.error.message : null,
  playError: window.__playError ?? null,
  playerState: player && player.getPlayerState ? player.getPlayerState() : null,
  songTitle: navigator.mediaSession && navigator.mediaSession.metadata ? navigator.mediaSession.metadata.title : null,
  audioTrack: player && player.getPlayerResponse ? (player.getPlayerResponse()?.playabilityStatus?.status ?? null) : null,
  playabilityReason: player && player.getPlayerResponse ? (player.getPlayerResponse()?.playabilityStatus?.reason ?? null) : null,
  encrypted: window.__sawEncrypted === true,
  audioContext: Boolean(window.AudioContext),
  adoptedStyleSheets: "adoptedStyleSheets" in document,
  bodyText: document.body ? document.body.innerText.replace(/\\s+/g, " ").slice(0, 300) : null,
});
"""

# Runs before the page's scripts, like the app's injected script.
EARLY = "document.addEventListener('encrypted', () => { window.__sawEncrypted = true; }, true);"


def main() -> int:
    Gtk.init(None)
    context = WebKit2.WebContext.get_default()
    cookies = context.get_website_data_manager().get_cookie_manager()
    # Says the cookie banner was answered, so the page loads instead of the consent form.
    consent = Soup.Cookie.new("SOCS", "CAI", ".youtube.com", "/", 60 * 60 * 24)
    consent.set_secure(True)
    cookies.add_cookie(consent, None, None, None)

    manager = WebKit2.UserContentManager()
    manager.add_script(
        WebKit2.UserScript.new(
            EARLY,
            WebKit2.UserContentInjectedFrames.TOP_FRAME,
            WebKit2.UserScriptInjectionTime.START,
            None,
            None,
        )
    )
    policies = WebKit2.WebsitePolicies(autoplay=WebKit2.AutoplayPolicy.ALLOW)
    view = WebKit2.WebView(user_content_manager=manager, website_policies=policies)
    settings = view.get_settings()
    settings.set_user_agent(USER_AGENT)
    settings.set_enable_mediasource(True)
    settings.set_enable_encrypted_media(True)
    settings.set_media_playback_requires_user_gesture(False)
    settings.set_enable_webaudio(True)

    window = Gtk.Window()
    window.set_default_size(1280, 800)
    window.add(view)
    window.show_all()

    major, minor, micro = (
        WebKit2.get_major_version(),
        WebKit2.get_minor_version(),
        WebKit2.get_micro_version(),
    )
    print(f"WebKitGTK {major}.{minor}.{micro}", flush=True)
    state = {"done": False, "code": 1}

    def finish(code: int) -> bool:
        state["code"] = code
        Gtk.main_quit()
        return False

    def on_result(_view, result) -> None:
        try:
            value = view.call_async_javascript_function_finish(result)
            report = json.loads(value.to_string())
            for key, entry in report.items():
                print(f"{key}: {entry}")
            finish(0)
        except Exception as error:  # noqa: BLE001
            print(f"probe failed: {error}")
            finish(1)

    def run_probe() -> bool:
        if not state["done"]:
            state["done"] = True
            view.call_async_javascript_function(PROBE, -1, None, None, None, None, on_result)
        return False

    def on_load(_view, event) -> None:
        print(f"load: {event.value_nick} {view.get_uri()}", flush=True)

    view.connect("load-changed", on_load)
    view.connect(
        "load-failed",
        lambda _view, _event, uri, error: print(f"load failed: {uri}: {error.message}") or False,
    )
    view.connect(
        "web-process-terminated", lambda _view, reason: print(f"web process ended: {reason.value_nick}") or finish(1)
    )
    # The page keeps loading parts for a while; give the player time to start.
    GLib.timeout_add_seconds(30, run_probe)
    GLib.timeout_add_seconds(120, lambda: print("timed out") or finish(1))
    view.load_uri(URL)
    Gtk.main()
    return state["code"]


if __name__ == "__main__":
    sys.exit(main())

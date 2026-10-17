"""Shows the settings window in WebKitGTK, as the app does on Linux, and takes
screenshots: the General tab, and its language list opened. The backend is
stood in for by a few answers, enough for the window to draw.

Run under a virtual screen from the repository root, after `npm run build:ui`:
    xvfb-run -a -s "-screen 0 800x900x24" python3 scripts/linux-ui-probe.py out/
Needs python3-gi, gir1.2-webkit2-4.1, xdotool and ImageMagick's `import`.
"""

import http.server
import os
import subprocess
import sys
import threading

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "probe-out"
ROOT = os.path.abspath("dist-ui")
PORT = 8765

BACKEND = """
(() => {
  const settings = {
    plugins: ["equalizer"], startup: false, startInTray: false, minimizeToTray: true,
    resumePlayback: true, language: "de", reloadPluginsOnChange: false,
    hardwareAcceleration: true, checkForUpdates: true, pluginSettings: {},
    shortcuts: { playPause: "", next: "", previous: "", volumeUp: "", volumeDown: "", toggleMute: "" },
    windowShortcuts: { like: "", dislike: "" },
  };
  const answers = {
    get_settings: settings,
    list_external_plugins: [],
    restart_required: false,
    get_health: { pageProblems: [], pluginErrors: {} },
    is_first_run: false,
    app_version: "0.9.0",
    pending_update: null,
  };
  let next = 1;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "settings" }, currentWebview: { label: "settings", windowLabel: "settings" } },
    invoke: (cmd) => Promise.resolve(cmd in answers ? answers[cmd] : null),
    transformCallback: () => next++,
    unregisterCallback: () => {},
    convertFileSrc: (path) => path,
  };
})();
"""


def serve():
    handler = lambda *args: http.server.SimpleHTTPRequestHandler(*args, directory=ROOT)  # noqa: E731
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever()


def shot(name):
    subprocess.run(["import", "-window", "root", os.path.join(OUT, name)], check=False)
    print("screenshot", name, flush=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    threading.Thread(target=serve, daemon=True).start()
    # What the app's windows ask for with `theme(Dark)`: GTK's dark variant.
    Gtk.Settings.get_default().set_property("gtk-application-prefer-dark-theme", True)
    window = Gtk.Window(title="Settings")
    window.set_default_size(620, 700)
    window.move(0, 0)
    manager = WebKit2.UserContentManager()
    manager.add_script(
        WebKit2.UserScript(
            BACKEND,
            WebKit2.UserContentInjectedFrames.TOP_FRAME,
            WebKit2.UserScriptInjectionTime.START,
            None,
            None,
        )
    )
    view = WebKit2.WebView.new_with_user_content_manager(manager)
    window.add(view)
    window.connect("destroy", Gtk.main_quit)
    window.show_all()
    view.load_uri(f"http://127.0.0.1:{PORT}/index.html")

    def run(script):
        view.evaluate_javascript(script, -1, None, None, None, None, None)

    steps = [
        (4000, lambda: run("[...document.querySelectorAll('[role=tab]')].find((t) => /Allgemein|General/.test(t.textContent))?.click()")),
        (1000, lambda: run("document.querySelector('select')?.scrollIntoView({ block: 'center' })")),
        (1000, lambda: shot("general.png")),
        # A click where the select is in "general.png": the list opens as a
        # window of its own, which only a screenshot of the screen shows.
        (500, lambda: subprocess.run(["xdotool", "mousemove", "470", "516", "click", "1"], check=False)),
        (1500, lambda: shot("language-open.png")),
        (500, lambda: subprocess.run(["xdotool", "key", "Escape"], check=False)),
        (500, lambda: run("[...document.querySelectorAll('[role=tab]')].find((t) => /Plugins/.test(t.textContent))?.click()")),
        (1000, lambda: shot("plugins.png")),
        (500, Gtk.main_quit),
    ]

    def chain(index=0):
        if index >= len(steps):
            return False
        delay, action = steps[index]

        def fire():
            action()
            chain(index + 1)
            return False

        GLib.timeout_add(delay, fire)
        return False

    chain()
    GLib.timeout_add(60000, Gtk.main_quit)
    Gtk.main()


if __name__ == "__main__":
    main()

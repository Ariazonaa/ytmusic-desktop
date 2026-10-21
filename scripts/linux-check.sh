#!/bin/sh
# Checks the app on this Linux desktop in the real app, and puts the settings
# and the plugins folder back afterwards, also when a check fails.
#
#   scripts/linux-check.sh [--app <program>] [--track <video id>] [--minutes <n>]
#
# Run it as the desktop's user, in its session (DISPLAY and the session bus
# set), on X11. It needs xdotool, xprop, dbus-send, dbus-monitor, curl and
# python3. The program defaults to `ytmusic-desktop` on the PATH, as the .deb
# and the Arch package install it; an AppImage or a build works the same.
#
# Each check prints PASS or FAIL:
# - the window opens, and the window is kept above others ("always on top")
# - a track plays on for --minutes (default 2.5) without stopping or starting
#   over, read from the player's MPRIS position
# - `--next` and `--play-pause` from a second launch, with one window left
# - the sleep timer: after 15 s, switched off again, and at the end of the track
# - the mini player: opens above others, its Next button works, it closes
# - "Output" in the tray menu (clicked over D-Bus) moves the sound to another
#   device and back, with two test devices of the sound server's own
# - after a minute's pause in the tray the page is unloaded, and Play / Pause
#   brings the track back playing, with the desktop's media controls
# - a global shortcut (Ctrl+Alt+P) pauses and plays
# - a notification goes out when a track starts while the window is minimized
# - the now-playing page answers with the playing track, and refuses a foreign Host
# - a ytmusic:// link opened with xdg-open plays its track (installed packages only)
# - a plugin from others that tries to leave its frame gets nothing out
# - no part of YouTube Music is reported missing, no unexpected log lines
set -u

APP=ytmusic-desktop
TRACK=09R8_2nJtjg
MINUTES=2.5
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP=$2; shift 2 ;;
    --track) TRACK=$2; shift 2 ;;
    --minutes) MINUTES=$2; shift 2 ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done

for tool in xdotool xprop dbus-send dbus-monitor curl python3; do
  command -v $tool >/dev/null || { echo "missing: $tool"; exit 2; }
done
: "${DISPLAY:?run this inside the desktop session}"
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
export DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}

CONFIG=$HOME/.config/io.github.ariazonaa.ytmusic-desktop
LOG=$CONFIG/log.txt
PORT=47891
TEST_PLUGIN=$CONFIG/plugins/linux-check-leak
BACKUP=$(mktemp -d)
FAILED=0

check() { # check <what> <0 = pass> [detail]
  if [ "$2" = 0 ]; then printf 'PASS  %s' "$1"; else printf 'FAIL  %s' "$1"; FAILED=$((FAILED + 1)); fi
  [ -n "${3:-}" ] && printf ' (%s)' "$3"
  printf '\n'
}

mpris_name() { dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null | grep -o 'org.mpris.MediaPlayer2[^"]*' | head -1; }
mpris_get() { dbus-send --session --print-reply --dest="$(mpris_name)" /org/mpris/MediaPlayer2 org.freedesktop.DBus.Properties.Get string:org.mpris.MediaPlayer2.Player "string:$1" 2>/dev/null; }
status() { mpris_get PlaybackStatus | grep -o '"[A-Za-z]*"' | tail -1 | tr -d '"'; }
title() { mpris_get Metadata | grep -A1 'xesam:title' | tail -1 | sed -n 's/.*string "\(.*\)"/\1/p'; }
position() { mpris_get Position | tail -1 | awk '{ printf "%d", $3 / 1000000 }'; }
wait_for() { # wait_for <seconds> <command...>: until the command succeeds
  limit=$1; shift
  i=0
  while [ $i -lt $((limit * 2)) ]; do "$@" && return 0; sleep 0.5; i=$((i + 1)); done
  return 1
}
is_status() { [ "$(status)" = "$1" ]; }
title_has() { case "$(title)" in *"$1"*) return 0 ;; *) return 1 ;; esac; }
title_is_not() { t=$(title); [ -n "$t" ] && [ "$t" != "$1" ]; }
window() { xdotool search --name '^YouTube Music$' 2>/dev/null | head -1; }
windows() { xdotool search --name '^YouTube Music$' 2>/dev/null | wc -l; }

# --- what is put back at the end ---
was_running=$(pgrep -x ytmusic-desktop >/dev/null && echo yes || echo no)
mkdir -p "$CONFIG/plugins"
[ -f "$CONFIG/settings.json" ] && cp "$CONFIG/settings.json" "$BACKUP/settings.json"
log_before=$( [ -f "$LOG" ] && wc -l < "$LOG" || echo 0 )
restore() {
  pkill -x ytmusic-desktop; sleep 2
  if [ -f "$BACKUP/settings.json" ]; then cp "$BACKUP/settings.json" "$CONFIG/settings.json"; else rm -f "$CONFIG/settings.json"; fi
  kill "${sink:-0}" 2>/dev/null
  for module in ${test_outputs:-}; do pactl unload-module "$module" 2>/dev/null; done
  rm -rf "$TEST_PLUGIN" "$BACKUP" "${sink_log:-}"
  if [ "$was_running" = yes ]; then nohup "$APP" >/dev/null 2>&1 & fi
  echo "put back: settings.json, the plugins folder and the sound devices"
}
trap restore EXIT
# A signal ends the script by way of EXIT, so that it is put back then too.
trap "exit 1" INT TERM HUP

# --- a plugin from others that tries to leave its frame ---
# It saves a setting of its own first, which shows that it ran, and then
# goes for an address on this machine where a listener counts what arrives.
SINK=47892
mkdir -p "$TEST_PLUGIN"
cat > "$TEST_PLUGIN/plugin.json" <<'EOF'
{ "name": "linux-check-leak", "version": "0.0.1", "description": "Test only: tries to leave its frame.", "permissions": [],
  "settings": { "ran": { "type": "boolean", "label": "Ran", "default": false } } }
EOF
cat > "$TEST_PLUGIN/index.js" <<EOF
ytmd.settings.update({ ran: true }).finally(() => { location.href = "http://127.0.0.1:$SINK/left-the-frame"; });
EOF
sink_log=$(mktemp)
python3 -c "
import http.server, sys
class Count(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        print(self.path, flush=True)
        self.send_response(204); self.end_headers()
    def log_message(self, *args): pass
http.server.HTTPServer(('127.0.0.1', $SINK), Count).serve_forever()
" > "$sink_log" 2>&1 &
sink=$!

# --- settings for the run ---
python3 - "$CONFIG/settings.json" "$PORT" <<'EOF'
import json, os, sys
path, port = sys.argv[1], int(sys.argv[2])
settings = json.load(open(path)) if os.path.exists(path) else {}
settings["plugins"] = ["adblock", "now-playing", "song-notification", "linux-check-leak"]
settings.setdefault("pluginSettings", {})["now-playing"] = {"page": True, "port": port, "told": True}
settings["shortcuts"] = {"playPause": "Ctrl+Alt+KeyP", "next": "", "previous": "", "volumeUp": "", "volumeDown": "", "toggleMute": ""}
settings["alwaysOnTop"] = True
settings["resumePlayback"] = False
json.dump(settings, open(path, "w"), indent=2)
EOF

pkill -x ytmusic-desktop; sleep 2
nohup "$APP" "https://music.youtube.com/watch?v=$TRACK" >/dev/null 2>&1 &
wait_for 40 sh -c "xdotool search --name '^YouTube Music\$' >/dev/null 2>&1"
check "the window opens" $?
W=$(window)
wait_for 40 sh -c "dbus-send --session --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus.ListNames | grep -q org.mpris.MediaPlayer2"
if ! wait_for 20 is_status Playing; then "$APP" --play-pause; wait_for 20 is_status Playing; fi
check "a track plays" $? "$(title)"
xprop -id "$W" _NET_WM_STATE | grep -q ABOVE
check "always on top" $?

# --- playing on: the stop after about a minute that YouTube's bot check caused ---
seconds=$(python3 -c "print(int(float('$MINUTES') * 60))")
positions=""; last=-1; steady=0
i=0
while [ $i -lt $((seconds / 10)) ]; do
  sleep 10
  p=$(position); positions="$positions $p"
  if [ "$p" -le "$last" ]; then steady=1; fi
  last=$p; i=$((i + 1))
done
[ $steady = 0 ] && [ "$last" -ge $((seconds - 30)) ]
check "plays on for $MINUTES minutes without stopping or starting over" $? "positions:$positions"

# --- from a second launch ---
before=$(title)
"$APP" --next
wait_for 20 title_is_not "$before"
check "--next from a second launch" $? "$before -> $(title)"
[ "$(windows)" = 1 ]
check "one window after the second launch" $?
# The next track has just started, and YouTube Music may take a pause back right then: a moment first.
sleep 3
"$APP" --play-pause
wait_for 10 is_status Paused
check "--play-pause pauses" $?
"$APP" --play-pause
wait_for 10 is_status Playing
check "--play-pause plays again" $?

# --- the sleep timer ---
"$APP" --sleep=15s
sleep 11
is_status Playing
early=$?
wait_for 12 is_status Paused
late=$?
check "sleep timer: still playing before, paused after 15 s" "$([ $early = 0 ] && [ $late = 0 ] && echo 0 || echo 1)"
"$APP" --play-pause
wait_for 10 is_status Playing
"$APP" --sleep=8s; sleep 2; "$APP" --sleep=off
sleep 12
is_status Playing
check "sleep timer switched off pauses nothing" $?
# "At the end of the track": a jump to shortly before the end, which must pause without the next track starting.
track=$(mpris_get Metadata | grep -A1 'mpris:trackid' | tail -1 | sed -n 's/.*object path "\(.*\)"/\1/p')
length=$(mpris_get Metadata | grep -A1 'mpris:length' | tail -1 | awk '{ print $3 }')
ending=$(title)
if [ -n "$track" ] && [ -n "$length" ]; then
  "$APP" --sleep=end
  dbus-send --session --dest="$(mpris_name)" /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2.Player.SetPosition \
    "objpath:$track" "int64:$((length - 8000000))" 2>/dev/null
  sleep 2
  if [ "$(position)" -ge $((length / 1000000 - 12)) ]; then
    wait_for 20 is_status Paused
    paused=$?
    check "sleep timer at the end of the track pauses there" "$([ $paused = 0 ] && [ "$(title)" = "$ending" ] && echo 0 || echo 1)" "$(status): $(title)"
  else
    echo "SKIP  sleep timer at the end of the track (the player does not seek over MPRIS)"
  fi
  "$APP" --sleep=off
else
  echo "SKIP  sleep timer at the end of the track (the player gives no track id or length over MPRIS)"
fi
is_status Paused && "$APP" --play-pause
wait_for 10 is_status Playing

# --- the mini player ---
"$APP" --mini-player
wait_for 15 sh -c "xdotool search --name '^Mini player\$' >/dev/null 2>&1"
check "mini player opens with --mini-player" $?
M=$(xdotool search --name '^Mini player$' 2>/dev/null | head -1)
if [ -n "$M" ]; then
  # The window manager may set the state a moment after the window shows.
  wait_for 10 sh -c "xprop -id $M _NET_WM_STATE | grep -q ABOVE"
  check "mini player is above other windows" $?
  sleep 3
  eval "$(xdotool getwindowgeometry --shell "$M")"
  before=$(title)
  # Its Next button sits at the right end of the bottom row.
  xdotool mousemove $((X + WIDTH - 28)) $((Y + HEIGHT - 26)) click 1
  wait_for 20 title_is_not "$before"
  check "mini player's Next button" $? "$before -> $(title)"
  "$APP" --mini-player
  sleep 3
  [ "$(xdotool search --name '^Mini player$' 2>/dev/null | wc -l)" = 0 ]
  check "mini player closes with --mini-player again" $?
fi

# --- the sound's device, in the tray menu ---
# The menu is read and clicked over D-Bus, as a desktop's panel does it.
# The panel's watcher knows where the app's tray icon is: "<bus name>/<path>".
menu_path=/org/ayatana/NotificationItem/tray_icon_tray_app_main/Menu
menu_dest() {
  busctl --user get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher     org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems 2>/dev/null |
    grep -o '"[^"]*tray_icon_tray_app_main' | tr -d '"' | cut -d/ -f1 | tail -1
}
menu_entries() { # id TAB label, submenus included
  busctl --user -j call "$1" $menu_path com.canonical.dbusmenu GetLayout iias 0 10 1 label 2>/dev/null | python3 -c '
import json, sys
def walk(node):
    ident, props, children = node
    label = props.get("label", {}).get("data", "")
    if label: print(ident, label, sep="\t")
    for child in children: walk(child["data"])
walk(json.load(sys.stdin)["data"][1])'
}
menu_click() { # menu_click <dest> <label>
  id=$(menu_entries "$1" | awk -F'\t' -v l="$2" '$2 == l { print $1; exit }')
  [ -n "$id" ] && busctl --user call "$1" $menu_path com.canonical.dbusmenu Event isvu "$id" clicked s "" 0
}
streams_on() { # the devices the app's sound goes to, by name
  pactl list short sink-inputs | awk '{ print $2 }' | sort -u | while read -r index; do
    pactl list short sinks | awk -v i="$index" '$1 == i { print $2 }'
  done | tr '\n' ' '
}
on_only() { [ "$(streams_on)" = "$1 " ]; }
test_devices_listed() { [ "$(menu_entries "$D" | grep -c '	YtmdCheck')" = 2 ]; }
if command -v pactl >/dev/null && command -v busctl >/dev/null; then
  test_outputs=""
  # Names without "_", which GTK's menus would show doubled over D-Bus.
  for name in YtmdCheckA YtmdCheckB; do
    test_outputs="$test_outputs $(pactl load-module module-null-sink sink_name=$name sink_properties=device.description=$name)"
  done
  D=$(menu_dest)
  # With only PipeWire's stand-in sink (auto_null, as on the test VMs), that
  # sink goes away with the first new one, and WirePlumber pauses the players
  # that played on it over MPRIS (linking.pause-playback): play on.
  sleep 2
  [ "$(status)" = Playing ] || "$APP" --play-pause
  wait_for 15 test_devices_listed
  check "Output in the tray menu lists the devices" $? "$(menu_entries "$D" | grep -c '	YtmdCheck') of 2"
  for name in YtmdCheckB YtmdCheckA; do
    menu_click "$D" $name >/dev/null
    wait_for 10 on_only $name
    check "Output: the sound goes to $name" $? "$(streams_on)"
  done
  saved=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('outputDevice'))" "$CONFIG/settings.json")
  check "Output: the choice is saved" "$([ "$saved" = YtmdCheckA ] && echo 0 || echo 1)" "$saved"
  default=$(pactl get-default-sink)
  menu_click "$D" "System default" >/dev/null
  wait_for 10 on_only "$default"
  check "Output: System default brings it back" $? "$(streams_on) / default $default"
  [ "$(status)" = Playing ] || "$APP" --play-pause
  wait_for 10 is_status Playing
else
  echo "SKIP  Output in the tray menu (no pactl or busctl)"
fi

# --- a global shortcut ---
# Right after playback started, YouTube Music may take a pause back: a moment first.
sleep 3
xdotool key --clearmodifiers ctrl+alt+p
wait_for 10 is_status Paused
paused=$?
check "global shortcut Ctrl+Alt+P pauses" $paused
sleep 2
xdotool key --clearmodifiers ctrl+alt+p
wait_for 10 is_status Playing
played=$?
# Counts only after a pause: playing on without one would pass by itself.
check "global shortcut Ctrl+Alt+P plays again" "$([ $paused = 0 ] && [ $played = 0 ] && echo 0 || echo 1)"

# --- the notification as a track starts while the window is minimized ---
monitor=$(mktemp)
dbus-monitor "interface=org.freedesktop.Notifications,member=Notify" > "$monitor" 2>&1 &
watcher=$!
sleep 1
xdotool windowminimize "$W"; sleep 1
before=$(title)
"$APP" --next
wait_for 20 title_is_not "$before"
sleep 3
kill $watcher 2>/dev/null
now=$(title)
grep -q "string \"$now\"" "$monitor"
check "notification when a track starts while minimized" $? "$now"
rm -f "$monitor"
xdotool windowmap "$W" windowactivate "$W" 2>/dev/null

# --- the now-playing page ---
sleep 2
page=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")
check "now-playing page answers" "$([ "$page" = 200 ] && echo 0 || echo 1)" "$page"
json=$(curl -s "http://127.0.0.1:$PORT/now-playing.json")
echo "$json" | python3 -c "import json,sys; t=json.load(sys.stdin)['title']; sys.exit(0 if t == sys.argv[1] else 1)" "$(title)"
check "now-playing.json has the playing track" $? "$(echo "$json" | head -c 100)"
foreign=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: example.com" "http://127.0.0.1:$PORT/")
check "now-playing page refuses a foreign Host" "$([ "$foreign" = 403 ] && echo 0 || echo 1)" "$foreign"

# --- a ytmusic:// link, as from a browser ---
handler=$(xdg-mime query default x-scheme-handler/ytmusic 2>/dev/null)
if [ -z "$handler" ]; then
  echo "SKIP  ytmusic:// links (no handler registered: not an installed package)"
else
  check "ytmusic:// is handed to the app" "$(case "$handler" in *ytmusic*) echo 0 ;; *) echo 1 ;; esac)" "$handler"
  xdg-open "ytmusic://watch?v=dQw4w9WgXcQ" >/dev/null 2>&1 &
  wait_for 30 title_has "Never Gonna Give You Up"
  check "a ytmusic:// link opens its track" $? "$(title)"
  check "one window after the link" "$([ "$(windows)" = 1 ] && echo 0 || echo 1)" "$(windows)"
fi

# --- unloading the page after a pause in the tray ---
# Started again with the setting at one minute: a track plays, is paused and
# the window goes to the tray. The page must go, giving memory back, and
# Play / Pause must bring the same track back playing.
app_rss() { # megabytes of the app and its web view's processes
  total=0
  for p in $(pgrep -x ytmusic-desktop) $(pgrep -f WebKitWebProcess) $(pgrep -f WebKitNetworkProcess); do
    total=$((total + $(awk '/VmRSS/ { print $2 }' /proc/$p/status 2>/dev/null || echo 0)))
  done
  echo $((total / 1024))
}
web_processes() { pgrep -f WebKitWebProcess | wc -l; }
pkill -x ytmusic-desktop; sleep 2
python3 - "$CONFIG/settings.json" <<'EOF'
import json, sys
path = sys.argv[1]
settings = json.load(open(path))
settings.update(unloadAfterMinutes=1, resumePlayback=True)
json.dump(settings, open(path, "w"), indent=2)
EOF
nohup "$APP" "https://music.youtube.com/watch?v=$TRACK" >/dev/null 2>&1 &
wait_for 60 is_status Playing
before_title=$(title)
sleep 5
"$APP" --play-pause
wait_for 10 is_status Paused
sleep 7 # the track and its place are saved every 5 seconds
W=$(window)
if xdotool help 2>&1 | grep -q windowquit; then xdotool windowquit "$W"; else xdotool windowactivate --sync "$W" key alt+F4; fi
sleep 3
check "the window goes to the tray when closed" "$([ "$(xdotool search --onlyvisible --name '^YouTube Music$' 2>/dev/null | wc -l)" = 0 ] && echo 0 || echo 1)"
loaded_rss=$(app_rss); loaded_processes=$(web_processes)
unloaded() { [ "$(web_processes)" -lt "$loaded_processes" ]; }
wait_for 150 unloaded
gone=$?
sleep 10
check "the page is unloaded after a minute's pause in the tray" $gone "$loaded_rss MB, $loaded_processes web processes -> $(app_rss) MB, $(web_processes)"
# Read from the app's now-playing page first; MPRIS is checked after it.
page_playing() {
  curl -s "http://127.0.0.1:$PORT/now-playing.json" | python3 -c "import json,sys; n=json.load(sys.stdin); sys.exit(0 if not n['paused'] and n['title'] == sys.argv[1] else 1)" "$1" 2>/dev/null
}
"$APP" --play-pause
wait_for 60 page_playing "$before_title"
check "Play / Pause loads it again and plays the same track" $? "$(curl -s "http://127.0.0.1:$PORT/now-playing.json" | head -c 100)"
wait_for 15 is_status Playing
# It has to stay there: another session of the page could take it off right after (desktop-controls.ts).
sleep 5
check "the desktop's media controls see it again (MPRIS)" "$(is_status Playing && [ "$(title)" = "$before_title" ] && echo 0 || echo 1)" "$(status): $(title)"

# --- what the log says ---
sleep 25   # the page check looks twice, the second time 20 seconds after a track starts
new=$( [ -f "$LOG" ] && tail -n +$((log_before + 1)) "$LOG" || true )
ran=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('pluginSettings', {}).get('linux-check-leak', {}).get('ran'))" "$CONFIG/settings.json")
arrived=$(grep -c . "$sink_log")
# What counts is that nothing arrives; the app logs a stop where WebKitGTK asks it.
check "a plugin leaving its frame: it ran, nothing left the frame" "$([ "$ran" = True ] && [ "$arrived" = 0 ] && echo 0 || echo 1)" \
  "ran $ran, requests $arrived, logged stop: $(echo "$new" | grep -c 'stopped a navigation to 127.0.0.1')"
echo "$new" | grep -q "parts of YouTube Music not found"
check "no part of YouTube Music missing" "$([ $? = 0 ] && echo 1 || echo 0)" "$(echo "$new" | grep 'not found' | tail -1 | cut -c1-200)"
others=$(echo "$new" | grep -v -e "stopped a navigation to 127.0.0.1" -e '^$')
check "no other lines in the log" "$([ -z "$others" ] && echo 0 || echo 1)" "$(echo "$others" | head -3 | tr '\n' ' ' | cut -c1-300)"

if [ $FAILED = 0 ]; then echo "all checks passed"; else echo "$FAILED check(s) failed"; fi
exit $FAILED

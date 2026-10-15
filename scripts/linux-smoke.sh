#!/usr/bin/env bash
# Starts the app on a virtual screen, takes screenshots and checks that it
# keeps running. For CI on Linux, see .github/workflows/linux-packages.yml.
#
# Usage: scripts/linux-smoke.sh <program> <screenshot prefix>
set -u

if [ "${1:-}" != "--inside" ]; then
  mkdir -p "$(dirname "$2")"
  exec xvfb-run -a -s "-screen 0 1280x800x24" dbus-run-session -- bash "$0" --inside "$1" "$2"
fi

program=$2
prefix=$3
"$program" > "$prefix-output.txt" 2>&1 &
pid=$!
last=0
for seconds in 20 45; do
  sleep $((seconds - last))
  last=$seconds
  import -window root "$prefix-${seconds}s.png" || true
done
if kill -0 "$pid" 2> /dev/null; then
  echo "the app is still running after 45 s"
  status=0
else
  echo "the app ended early"
  status=1
fi
kill "$pid" 2> /dev/null
wait "$pid" 2> /dev/null
tail -n 40 "$prefix-output.txt"
exit $status

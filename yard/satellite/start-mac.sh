#!/usr/bin/env bash
# start-mac.sh - run the satellite on a MacBook, camera included
#
# Usage:
#   ./start-mac.sh                                  # venv at the repo's .venv
#   VENV=~/my-venv ./start-mac.sh                   # any other venv
#   ROVER_URL=http://curiosity.local:8523 ./start-mac.sh
#
# David's original started camera_server's Mac twin directly, next to the web
# server. This asks the web server to start the camera instead, because the
# console has to own that process: picking another camera on Settings restarts
# it, and a camera the console did not start is one it cannot restart - the
# new one fails to bind 8890 while the old one keeps the device.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# mac-env first: the venv David's original setup created, so a Mac already
# set up that way keeps working.
if [[ -z "${VENV:-}" ]]; then
    if [[ -x "$SCRIPT_DIR/mac-env/bin/python" ]]; then
        VENV="$SCRIPT_DIR/mac-env"
    else
        VENV="$REPO_ROOT/.venv"
    fi
fi
PYTHON="$VENV/bin/python"
PORT="${SATELLITE_PORT:-3001}"
BASE="http://localhost:$PORT"

if [[ ! -x "$PYTHON" ]]; then
    echo "Venv not found at $VENV"
    echo "Create it first:"
    echo "  python3 -m venv $VENV"
    echo "  $VENV/bin/pip install -r $SCRIPT_DIR/requirements.txt"
    exit 1
fi

echo "Starting Mars Yard satellite (Mac mode)"
echo "  Pages:          $BASE"
echo "  Settings:       $BASE/settings  (pick the camera here)"
echo "  Camera stream:  ws://localhost:8890"
echo "  Press Ctrl-C to stop"
echo ""

WEB_PID=""
cleanup() {
    echo ""
    echo "Stopping..."
    # The camera runs in its own session so it survives a web-server reload;
    # that also means killing the web server leaves it running. Ask first.
    curl -s -X POST "$BASE/operator/api/camera/stop" >/dev/null 2>&1 || true
    [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
    [[ -n "$WEB_PID" ]] && wait "$WEB_PID" 2>/dev/null || true
    echo "Done."
}
trap cleanup EXIT
trap 'exit 130' INT TERM

cd "$SCRIPT_DIR"
SATELLITE_PORT="$PORT" "$PYTHON" web_server.py &
WEB_PID=$!

# Polled, not slept: how long Flask takes to bind varies by machine.
for _ in $(seq 1 30); do
    curl -s -o /dev/null "$BASE/api/status" && break
    kill -0 "$WEB_PID" 2>/dev/null || { echo "Web server exited during startup."; exit 1; }
    sleep 0.5
done

# No index: the camera last picked on Settings, or camera 0.
if curl -s -f -X POST "$BASE/operator/api/camera/start" \
        -H 'Content-Type: application/json' -d '{}' >/dev/null; then
    echo "Camera started."
else
    echo "Camera did not start. The reason is on $BASE/settings;"
    echo "on a Mac it is usually Camera permission for this terminal."
fi

# `wait -n` needs bash 4.3 and macOS ships 3.2, so wait on the one process.
wait "$WEB_PID"

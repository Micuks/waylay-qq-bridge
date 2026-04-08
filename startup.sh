#!/bin/sh
set -e

echo "$(date): qq-bridge startup"

export DISPLAY=:99
export LIBGL_ALWAYS_SOFTWARE=1

# Bridge config via environment
export BRIDGE_PORT="${BRIDGE_PORT:-13000}"
export BRIDGE_HOST="${BRIDGE_HOST:-0.0.0.0}"
export QQ_APP_DIR="/opt/QQ/resources/app"

# --- Clean stale X lock ---
LOCK_FILE="/tmp/.X99-lock"
[ -f "$LOCK_FILE" ] && rm -f "$LOCK_FILE"

# --- Start Xvfb (needed by wrapper.node for some GUI-dependent init) ---
echo "$(date): Starting Xvfb..."
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX -noreset -dpi 96 &
XFB_PID=$!

# Wait for X server
RETRY=0
while ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do
    RETRY=$((RETRY+1))
    if [ $RETRY -gt 15 ]; then
        echo "$(date): ERROR: Xvfb failed to start"
        exit 1
    fi
    sleep 1
done
echo "$(date): Xvfb ready"

# --- Start qq-bridge via QQ's Electron ---
# We run QQ's Electron binary which loads our patched package.json.
# This ensures wrapper.node can find all native symbols (qq_magic_napi_register, etc.)
echo "$(date): Starting qq-bridge (via QQ Electron)..."

exec dbus-run-session /opt/QQ/qq \
    --no-sandbox \
    --disable-gpu \
    --disable-software-rasterizer \
    --in-process-gpu

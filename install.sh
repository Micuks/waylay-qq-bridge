#!/bin/bash
set -e

# Waylay — One-click installer for bare-metal Linux (amd64)
# Usage: curl -fsSL https://raw.githubusercontent.com/Micuks/waylay-qq-bridge/master/install.sh | bash

WAYLAY_DIR="${WAYLAY_DIR:-/opt/waylay}"
QQ_DEB_URL="https://dldir1v6.qq.com/qqfile/qq/QQNT/Linux/QQ_3.2.27_260401_amd64_01.deb"
NODE_MAJOR=22

echo "=============================="
echo "  Waylay Installer"
echo "=============================="
echo ""
echo "Install directory: $WAYLAY_DIR"
echo ""

# --- Check architecture ---
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
  echo "Error: Only x86_64 (amd64) is supported. Detected: $ARCH"
  exit 1
fi

# --- Check root ---
if [ "$(id -u)" -ne 0 ]; then
  echo "Error: Please run as root (sudo)"
  exit 1
fi

# --- Install system dependencies ---
echo "[1/6] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl git \
  xvfb dbus x11-utils \
  libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libgtk-3-0 libgbm1 libasound2 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libxkbcommon0 libpango-1.0-0 libcairo2 \
  libxshmfence1 libx11-xcb1 libxcb-dri3-0 mesa-utils libgl1-mesa-glx \
  > /dev/null 2>&1
echo "    Done."

# --- Install Node.js ---
if ! command -v node &> /dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
  echo "[2/6] Installing Node.js ${NODE_MAJOR}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
  echo "    Node.js $(node -v) installed."
else
  echo "[2/6] Node.js $(node -v) already installed. Skipping."
fi

# --- Install ffmpeg ---
if ! command -v ffmpeg &> /dev/null; then
  echo "[3/6] Installing ffmpeg..."
  apt-get install -y -qq ffmpeg > /dev/null 2>&1
  echo "    Done."
else
  echo "[3/6] ffmpeg already installed. Skipping."
fi

# --- Install QQ Linux ---
if [ ! -f /opt/QQ/qq ]; then
  echo "[4/6] Installing QQ Linux..."
  curl -fsSL -o /tmp/qq.deb "$QQ_DEB_URL"
  dpkg -i /tmp/qq.deb > /dev/null 2>&1 || apt-get install -f -y -qq > /dev/null 2>&1
  rm -f /tmp/qq.deb
  echo "    QQ installed at /opt/QQ/"
else
  echo "[4/6] QQ already installed. Skipping."
fi

# --- Download Waylay ---
echo "[5/6] Setting up Waylay..."
if [ -d "$WAYLAY_DIR" ]; then
  echo "    Updating existing installation..."
  cd "$WAYLAY_DIR"
  git pull --quiet
else
  git clone --quiet https://github.com/Micuks/waylay-qq-bridge.git "$WAYLAY_DIR"
  cd "$WAYLAY_DIR"
fi
npm install --production --quiet 2>/dev/null
echo "    Done."

# --- Patch QQ ---
echo "[6/6] Patching QQ entry point..."
cp "$WAYLAY_DIR/src/electron-entry.js" /opt/QQ/resources/app/qq-bridge-entry.js
node -e "
  const fs = require('fs');
  const pkgPath = '/opt/QQ/resources/app/package.json';
  const pkg = JSON.parse(fs.readFileSync(pkgPath));
  if (pkg.main !== './qq-bridge-entry.js') {
    pkg._originalMain = pkg.main;
    pkg.main = './qq-bridge-entry.js';
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    console.log('    QQ patched successfully.');
  } else {
    console.log('    QQ already patched. Skipping.');
  }
"

# --- Create systemd service ---
cat > /etc/systemd/system/waylay.service << 'UNIT'
[Unit]
Description=Waylay QQ Bridge
After=network.target

[Service]
Type=simple
Environment=DISPLAY=:99
Environment=LIBGL_ALWAYS_SOFTWARE=1
Environment=BRIDGE_PORT=13000
Environment=BRIDGE_HOST=0.0.0.0
Environment=ONEBOT_WS_PORT=3001
Environment=ONEBOT_WS_HOST=0.0.0.0
Environment=ONEBOT_WS_REVERSE_URLS=[]
Environment=ONEBOT_TOKEN=
Environment=QQ_APP_DIR=/opt/QQ/resources/app
WorkingDirectory=/opt/waylay
ExecStartPre=/usr/bin/Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX -noreset
ExecStart=/usr/bin/dbus-run-session /opt/QQ/qq --no-sandbox --disable-gpu --disable-software-rasterizer --in-process-gpu
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload

echo ""
echo "=============================="
echo "  Installation complete!"
echo "=============================="
echo ""
echo "Edit environment variables:"
echo "  sudo systemctl edit waylay"
echo ""
echo "  Example overrides:"
echo "    [Service]"
echo "    Environment=AUTO_LOGIN_QQ=123456789"
echo "    Environment=ONEBOT_WS_REVERSE_URLS=[\"ws://127.0.0.1:2536/OneBotv11\"]"
echo ""
echo "Start Waylay:"
echo "  sudo systemctl start waylay"
echo "  sudo systemctl enable waylay   # auto-start on boot"
echo ""
echo "View QR code:"
echo "  curl http://localhost:13000/qrcode"
echo ""
echo "Logs:"
echo "  journalctl -u waylay -f"
echo ""

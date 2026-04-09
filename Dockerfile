FROM debian:bookworm-slim

# System dependencies for Electron/wrapper.node: Xvfb, dbus, libGL, X11 libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xvfb dbus x11-utils \
    libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libgtk-3-0 libgbm1 libasound2 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libxkbcommon0 libpango-1.0-0 libcairo2 \
    libxshmfence1 libx11-xcb1 libxcb-dri3-0 mesa-utils libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# Install QQ Linux
RUN curl -fsSL -o /tmp/qq.deb \
    "https://dldir1v6.qq.com/qqfile/qq/QQNT/Linux/QQ_3.2.27_260401_amd64_01.deb" && \
    dpkg -i /tmp/qq.deb || apt-get update && apt-get install -f -y && \
    rm -f /tmp/qq.deb && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 and ffmpeg
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs ffmpeg && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy bridge source
WORKDIR /app/qq-bridge
COPY package.json ./
RUN npm install --production
COPY src/ ./src/

# Patch QQ's package.json to load our bridge entry instead of encrypted QQ app
COPY src/electron-entry.js /opt/QQ/resources/app/qq-bridge-entry.js
RUN node -e " \
  const fs = require('fs'); \
  const pkg = JSON.parse(fs.readFileSync('/opt/QQ/resources/app/package.json')); \
  pkg._originalMain = pkg.main; \
  pkg.main = './qq-bridge-entry.js'; \
  fs.writeFileSync('/opt/QQ/resources/app/package.json', JSON.stringify(pkg, null, 2)); \
"

COPY startup.sh /startup.sh
RUN chmod +x /startup.sh

EXPOSE 13000

CMD ["/startup.sh"]

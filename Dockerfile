# Build on top of the official PMHQ image which already has QQ installed
FROM docker.1ms.run/linyuchen/pmhq:latest

# Install Node.js 22 (needed for npm install of ws package)
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy bridge source
WORKDIR /app/qq-bridge
COPY package.json ./
RUN npm install --production
COPY src/ ./src/

# Patch QQ's package.json to load our bridge entry instead of encrypted QQ app.
# The main field is resolved relative to /opt/QQ/resources/app/, so we place
# a tiny loader there and point main to it.
COPY src/electron-entry.js /opt/QQ/resources/app/qq-bridge-entry.js
RUN node -e " \
  const fs = require('fs'); \
  const pkg = JSON.parse(fs.readFileSync('/opt/QQ/resources/app/package.json')); \
  pkg._originalMain = pkg.main; \
  pkg.main = './qq-bridge-entry.js'; \
  fs.writeFileSync('/opt/QQ/resources/app/package.json', JSON.stringify(pkg, null, 2)); \
"

# Replace the startup script to run our bridge instead of PMHQ
COPY startup.sh /startup.sh
RUN chmod +x /startup.sh

EXPOSE 13000

CMD ["/startup.sh"]

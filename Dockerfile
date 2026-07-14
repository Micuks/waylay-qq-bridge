# syntax=docker/dockerfile:1.7
FROM node:24-trixie-slim

ARG TARGETARCH
ARG USER_NAME=node
# QQ NT Linux package. 3.2.31 ships on qqdl.gtimg.cn under a per-release,
# hash-prefixed beta path (see AUR `linuxqq`); the old dldir1v6 `/Linux/*_01.deb`
# scheme 404s for it. Override QQ_PKG_PREFIX + QQ_VERSION together to move versions.
ARG QQ_VERSION=3.2.31-51102
ARG QQ_PKG_PREFIX=https://qqdl.gtimg.cn/qqfile/QQNT/9.9.32/beta/c390e792
ARG APP_UID=1000
ARG APP_GID=1000

# Use TUNA mirror for faster apt downloads in China
# RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates && \
    deb_arch="${TARGETARCH:-$(dpkg --print-architecture)}" && \
    case "$deb_arch" in amd64|arm64) ;; *) echo "Unsupported architecture: $deb_arch" >&2; exit 1 ;; esac && \
    curl -fsSL -o /tmp/qq.deb "${QQ_PKG_PREFIX}/linuxqq_${QQ_VERSION}_${deb_arch}.deb" && \
    apt-get install -y --no-install-recommends \
      xvfb dbus x11-utils \
      libgbm1 libxshmfence1 ffmpeg \
      /tmp/qq.deb && \
    rm -f /tmp/qq.deb

# Use npmmirror for faster npm downloads in China
# RUN npm config set registry https://registry.npmmirror.com

# Reuse the pre-existing `node` user/group from the base image (UID/GID 1000).
# Override APP_UID/APP_GID/USER_NAME at build time only if you need to match
# a different host UID or rename the runtime account; the user/group is then
# modified in place.
RUN set -e; \
    if [ "${APP_GID}" != "1000" ]; then groupmod -g "${APP_GID}" node; fi; \
    if [ "${APP_UID}" != "1000" ]; then usermod  -u "${APP_UID}" node; fi; \
    if [ "${USER_NAME}" != "node" ]; then \
        groupmod -n "${USER_NAME}" node; \
        usermod  -l "${USER_NAME}" -d "/home/${USER_NAME}" -m node; \
    fi; \
    chown -R "${APP_UID}:${APP_GID}" "/home/${USER_NAME}"

# Root-only build steps first, so we only need a single USER switch below.
# Patch QQ's package.json to load our bridge entry; result is world-readable
# so the non-root runtime user can still load it.
COPY src/electron-entry.js /opt/QQ/resources/app/qq-bridge-entry.js
RUN node -e " \
  const fs = require('fs'); \
  const pkg = JSON.parse(fs.readFileSync('/opt/QQ/resources/app/package.json')); \
  pkg._originalMain = pkg.main; \
  pkg.main = './qq-bridge-entry.js'; \
  fs.writeFileSync('/opt/QQ/resources/app/package.json', JSON.stringify(pkg, null, 2)); \
"
COPY --chmod=755 startup.sh /startup.sh

# Hand /app to the runtime user, then drop privileges for everything below.
RUN install -d -o ${USER_NAME} -g ${USER_NAME} /app/qq-bridge
WORKDIR /app/qq-bridge
USER ${APP_UID}:${APP_GID}

COPY --chown=${APP_UID}:${APP_GID} package.json package-lock.json ./
RUN --mount=type=cache,target=/home/${USER_NAME}/.npm,uid=${APP_UID},gid=${APP_GID} \
    npm ci --omit=dev
COPY --chown=${APP_UID}:${APP_GID} src/ ./src/

EXPOSE 13000

CMD ["/startup.sh"]

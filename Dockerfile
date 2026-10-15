# OpenClaw runtime: the official release image, pinned by digest (Node 24, pnpm, tini included).
#
# Upgrading a volume that was last run on a release older than 2026.7 requires the
# 2026.9.5 bridge release first. See "Upgrading OpenClaw" in README.md. Build the bridge with:
#   --build-arg OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:2026.9.5@sha256:ea298b62be8955d3ef750e2004a610dd90c3a30e5f9886e5d654d78a0c573218
ARG OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:2026.10.3@sha256:70b8dbd23f8d27a206f43f9828fdebc87289e50d56dc55177354c9270d764026

FROM ${OPENCLAW_IMAGE}

# The upstream image runs as `node`, but Railway volumes mount root-owned and existing
# /data state was written by root.
USER root

ENV NODE_ENV=production

# Persist user-installed tools by default by targeting the Railway volume.
# - npm global installs -> /data/npm
# - pnpm global installs -> /data/pnpm (binaries) + /data/pnpm-store (store)
ENV NPM_CONFIG_PREFIX=/data/npm
ENV NPM_CONFIG_CACHE=/data/npm-cache
ENV PNPM_HOME=/data/pnpm
ENV PNPM_STORE_DIR=/data/pnpm-store
ENV PATH="/data/npm/bin:/data/pnpm:${PATH}"

# OpenClaw lives in /app in the upstream image; keep the wrapper separate.
ENV OPENCLAW_ENTRY=/app/openclaw.mjs
WORKDIR /wrapper

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

# The upstream HEALTHCHECK targets the bare gateway; Railway probes the wrapper via railway.toml.
HEALTHCHECK NONE

# The wrapper listens on $PORT.
# IMPORTANT: Do not set a default PORT here.
# Railway injects PORT at runtime and routes traffic to that port.
# If we force a different port, deployments can come up but the domain will route elsewhere.
EXPOSE 8080

# Ensure PID 1 reaps zombies and forwards signals.
ENTRYPOINT ["tini", "--"]
CMD ["node", "src/server.js"]

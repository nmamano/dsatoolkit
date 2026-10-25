# Self-hosted dsatoolkit.com on the shared VPS (~/nil/self-host-playbook.md), vendored
# from nilmamano.com's Dockerfile. The image takes a prebuilt site: GitHub Actions runs
# `bun run build` and `node ops/self-host/stage-image.mjs` first
# (.github/workflows/site-image.yml); this image never builds anything.
# The site is small (public/ is about 4 MB), so .image/app/ is the one layer.
# Secrets come at run time from a root-only env file on the VPS (compose.yaml).
# The same base and digest as nilmamano.com: one patch stream, a shared layer on disk.
# Node 22.23.4 fixes CVE-2026-111497 (Brotli decoder, 2026-10-21); bump the tag and digest together.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
# Memory limit 256 MiB (compose.yaml); the V8 heap cap keeps Node under it.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 NODE_OPTIONS=--max-old-space-size=192
WORKDIR /app
COPY .image/app/ ./
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "require('node:http').get({socketPath: process.env.SITE_SOCKET || '/run/dsatoolkit/site.sock', path: '/'}, r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
CMD ["node", "socket-entry.cjs"]

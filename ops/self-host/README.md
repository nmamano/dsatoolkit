# dsatoolkit.com on the shared VPS

The same pattern as nilmamano.com, whose `ops/self-host/` these files are vendored from (`~/nil/self-host-playbook.md` on the office box). This file holds no secret, address or key path; those are in the gitignored `ops-private/`.

- **Build.** `.github/workflows/site-image.yml` runs on every push to `main`: tests, `bun run build` (Next `output: "standalone"`), `stage-image.mjs`, and a push to `ghcr.io/nmamano/dsatoolkit-site` with the tags `main`, `sha-<commit>` and `inputs-<digest>`. A push that changes no image input (`image-inputs.mjs`) only moves `main`.
- **Layer.** `public/` is about 4 MB, so the app and `public/` are one layer (`stage-image.mjs`, Dockerfile). Every staged file has one fixed mtime.
- **Run.** `compose.yaml`: the site and an egress allowlist proxy (`egress-proxy.mjs`), both from the same image, read-only, no capabilities, a dedicated user. The site has no route out except through the proxy, and no published port: Caddy connects to `/run/dsatoolkit/site.sock` (`socket-entry.cjs` forwards it to Next on 127.0.0.1:3000 inside the container). Limits: site 0.5 CPU / 256 MiB, proxy 0.1 CPU / 96 MiB.
- **Deploy.** `dsatoolkit-autodeploy.timer` runs `auto-deploy.sh` five minutes after the last run. A new digest on `main` is pulled by digest and swapped in; a failed check rolls back. The checks: the container is healthy, `/` through the socket has the toolkit text, and `/favicon/favicon.ico` answers. After a healthy swap, it removes this site's old images (the running one and the rollback stay) and purges the Cloudflare zone (`purge_everything`, three tries; a failure is logged and does not fail the deploy).
- **Caching.** Pages send `Cache-Control: public, max-age=0, s-maxage=300` (`next.config.mjs` headers()). One Cloudflare cache rule caches pages at the edge, except `/api/*` and Next client navigation (an `RSC` header or an `_rsc` query).
- **Caddy.** `dsatoolkit.caddy`: the site on `www.dsatoolkit.com`, and a 308 to it, path and query kept, from `dsatoolkit.com` (Vercel also redirected the apex to www) and from plain HTTP on both names (the host's catch-all `http://` block would answer 421). `dsatoolkit.stage.caddy` is the staging block.
- **Chat.** `app/lib/chat-guard.ts`: 32 KB body, 20 messages, 2,000 characters a visitor message, last message from the visitor. `app/lib/rate-limit.ts`: 5 a minute / 20 an hour per visitor, keyed on the first X-Forwarded-For address (Caddy sets it to the visitor's address).

## First install (by hand, once)

| Path | Mode | Content |
|---|---|---|
| user `dsa-site` | | `useradd --system --no-create-home --shell /usr/sbin/nologin dsa-site` |
| `/etc/dsatoolkit/` | 0700 root | The env directory. |
| `/etc/dsatoolkit/auto-deploy.env` | 0600 root | `auto-deploy.env.example`, with `DSA_CF_ZONE` once the zone ID is known. |
| `/etc/dsatoolkit/site.env` | 0600 root | The site secrets (names in `compose.yaml`). Piped from the office box, never printed. |
| `/etc/dsatoolkit/purge-token` | 0600 root | The Cloudflare purge-only token for the dsatoolkit.com zone, one line. |
| `/etc/tmpfiles.d/dsatoolkit.conf` | 0644 | `dsatoolkit.tmpfiles.conf`, then `systemd-tmpfiles --create`. |
| `/opt/dsatoolkit/compose.yaml` | 0644 | A copy of `compose.yaml`. |
| `/opt/dsatoolkit/release.env` | 0600 | `DSA_UID=`, `DSA_GID=` (of `dsa-site`) and `DSA_SITE_IMAGE=ghcr.io/nmamano/dsatoolkit-site@sha256:<digest>`. |
| `/opt/dsatoolkit/release.commit` | 0600 | The image's `org.opencontainers.image.revision` label (40 hex characters). |
| `/opt/dsatoolkit/ops/` | 0755 | `auto-deploy.sh` and the two `dsatoolkit-autodeploy.*` units (the script keeps the installed units equal to these copies). |

Until all of these exist, every tick ends `refused` and changes nothing.

## Rollback

- A failed check after a swap: automatic (the previous digest runs again, the new one goes on `auto-deploy/failed`).
- A bad commit: `git revert` and push; the next image deploys within about 10 minutes.
- A pin: create `/etc/dsatoolkit/auto-deploy.hold`, put the wanted digest in `release.env` and its commit in `release.commit`, then `docker compose -p dsatoolkit -f /opt/dsatoolkit/compose.yaml --env-file /opt/dsatoolkit/release.env up -d --wait`.
- Back to Vercel during the soak: remove the `cloudflare_only` gate first (a drained Caddy reload), then point the DNS records back at Vercel.

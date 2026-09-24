#!/usr/bin/env bash
# Builds the site, puts it on the desk, restarts the server there, and gives
# Cloudflare the new copy. From the project folder: `bun run deploy`.
set -euo pipefail
cd "$(dirname "$0")/.."
DESK="${DESK:-kc@archlinux}"

bun run build
bun run build:server

# The desk: the site, the server, and the service files (systemd, as kc).
ssh "$DESK" 'mkdir -p ~/site ~/.config/systemd/user'
rsync -az --delete --exclude .assetsignore dist/ "$DESK:site/dist/"
rsync -az build/server.mjs "$DESK:site/server.mjs"
rsync -az deploy/kc-site.service deploy/cloudflared.service "$DESK:.config/systemd/user/"
ssh "$DESK" 'systemctl --user daemon-reload && systemctl --user enable --now kc-site.service && systemctl --user restart kc-site.service && systemctl --user is-active kc-site.service'

# Cloudflare: the Worker, and its copy of the site (after a one-time `bunx wrangler login`).
if bunx wrangler whoami 2>/dev/null | grep -q 'logged in'; then
  bunx wrangler deploy
else
  echo "Skipped Cloudflare: run 'bunx wrangler login' once, then deploy again."
fi

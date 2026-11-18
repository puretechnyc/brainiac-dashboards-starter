#!/usr/bin/env bash
# Publish the dashboard to Cloudflare Pages behind the password gate.
#   1. npx wrangler@4 login            (once)
#   2. bash deploy/deploy_cloudflare.sh my-ads-dashboard
# Then set DASHBOARD_PASSWORD in the Pages project (Settings > Variables and secrets).
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${1:-ads-dashboard}"
OUT="$(mktemp -d)"
cp public/index.html public/data.json "$OUT/"
cp deploy/_worker.js "$OUT/_worker.js"
npx wrangler@4 pages deploy "$OUT" --project-name "$PROJECT"
rm -rf "$OUT"

#!/usr/bin/env bash
# Fetch PL standings from football-data.org and push to the LMS API.
# Required env vars:
#   FOOTBALL_DATA_API_KEY  — your football-data.org token
#   SYNC_SECRET            — the SYNC_SECRET set in Cloudflare Pages
#
# Optional env vars:
#   API_BASE  — override API host (default: https://lms-pwa-v1.pages.dev)
#
# Usage:
#   FOOTBALL_DATA_API_KEY=xxx SYNC_SECRET=yyy ./scripts/sync-standings.sh
#
# Suggested cron (twice weekly, Mon & Thu 07:00):
#   0 7 * * 1,4 FOOTBALL_DATA_API_KEY=xxx SYNC_SECRET=yyy /path/to/sync-standings.sh

set -euo pipefail

: "${FOOTBALL_DATA_API_KEY:?FOOTBALL_DATA_API_KEY is required}"
: "${SYNC_SECRET:?SYNC_SECRET is required}"

API_BASE="${API_BASE:-https://lms-pwa-v1.pages.dev}"

FD_URL="https://api.football-data.org/v4/competitions/PL/standings"
SYNC_URL="${API_BASE}/api/admin/sync-standings"

FD_TMP=$(mktemp)
SYNC_TMP=$(mktemp)
trap 'rm -f "$FD_TMP" "$SYNC_TMP"' EXIT

echo "Fetching PL standings..."
FD_STATUS=$(curl -s -o "$FD_TMP" -w '%{http_code}' "$FD_URL" \
  -H "X-Auth-Token: ${FOOTBALL_DATA_API_KEY}")

if [ "$FD_STATUS" != "200" ]; then
  echo "ERROR: football-data.org returned HTTP ${FD_STATUS}"
  cat "$FD_TMP"
  exit 1
fi

TEAM_COUNT=$(python3 -c "
import sys, json
d = json.load(sys.stdin)
table = d['standings'][0]['table']
print(len(table))
" < "$FD_TMP" 2>/dev/null || echo "?")
echo "Fetched ${TEAM_COUNT} teams. Syncing standings to ${SYNC_URL}..."

SYNC_STATUS=$(curl -s -o "$SYNC_TMP" -w '%{http_code}' -X POST "$SYNC_URL" \
  -H "Authorization: Bearer ${SYNC_SECRET}" \
  -H "Content-Type: application/json" \
  --data @"$FD_TMP")

if [ "$SYNC_STATUS" != "200" ]; then
  echo "ERROR: sync API returned HTTP ${SYNC_STATUS}"
  cat "$SYNC_TMP"
  exit 1
fi

echo "Done: $(cat "$SYNC_TMP")"

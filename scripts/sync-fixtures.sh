#!/usr/bin/env bash
# Fetch PL fixtures from football-data.org and push to the LMS API.
# Required env vars:
#   FOOTBALL_DATA_API_KEY  — your football-data.org token
#   SYNC_SECRET            — the SYNC_SECRET set in Cloudflare Pages
#
# Optional env vars:
#   SEASON    — 4-digit season start year (default: 2024 = 2024/25)
#   API_BASE  — override API host (default: https://lms-pwa-v1.pages.dev)
#
# Usage:
#   FOOTBALL_DATA_API_KEY=xxx SYNC_SECRET=yyy ./scripts/sync-fixtures.sh
#   SEASON=2024 ./scripts/sync-fixtures.sh

set -euo pipefail

: "${FOOTBALL_DATA_API_KEY:?FOOTBALL_DATA_API_KEY is required}"
: "${SYNC_SECRET:?SYNC_SECRET is required}"

SEASON="${SEASON:-2024}"
API_BASE="${API_BASE:-https://lms-pwa-v1.pages.dev}"

FD_URL="https://api.football-data.org/v4/competitions/PL/matches?season=${SEASON}"
SYNC_URL="${API_BASE}/api/admin/sync-fixtures"

FD_TMP=$(mktemp)
SYNC_TMP=$(mktemp)
trap 'rm -f "$FD_TMP" "$SYNC_TMP"' EXIT

echo "Fetching PL fixtures for season ${SEASON}..."
FD_STATUS=$(curl -s -o "$FD_TMP" -w '%{http_code}' "$FD_URL" -H "X-Auth-Token: ${FOOTBALL_DATA_API_KEY}")

if [ "$FD_STATUS" != "200" ]; then
  echo "ERROR: football-data.org returned HTTP ${FD_STATUS}"
  cat "$FD_TMP"
  exit 1
fi

MATCH_COUNT=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('matches', [])))" < "$FD_TMP" 2>/dev/null || echo "?")
echo "Fetched ${MATCH_COUNT} matches. Syncing to ${SYNC_URL}..."

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

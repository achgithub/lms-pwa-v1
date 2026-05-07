#!/usr/bin/env bash
# Fetch PL teams from football-data.org and import into a group in D1.
# Required env vars:
#   FOOTBALL_DATA_API_KEY  — your football-data.org token
#   SYNC_SECRET            — the SYNC_SECRET set in Cloudflare Pages
#   GROUP_ID               — the D1 group ID to import teams into
#
# Optional env vars:
#   API_BASE  — override API host (default: https://lms-pwa-v1.pages.dev)
#
# Usage:
#   FOOTBALL_DATA_API_KEY=xxx SYNC_SECRET=yyy GROUP_ID=1 ./scripts/import-teams.sh

set -euo pipefail

: "${FOOTBALL_DATA_API_KEY:?FOOTBALL_DATA_API_KEY is required}"
: "${SYNC_SECRET:?SYNC_SECRET is required}"
: "${GROUP_ID:?GROUP_ID is required}"

API_BASE="${API_BASE:-https://lms-pwa-v1.pages.dev}"

FD_URL="https://api.football-data.org/v4/competitions/PL/teams"
IMPORT_URL="${API_BASE}/api/admin/import-teams"

TEAMS_TMP=$(mktemp)
RESULT_TMP=$(mktemp)
trap 'rm -f "$TEAMS_TMP" "$RESULT_TMP"' EXIT

echo "Fetching PL teams..."
FD_STATUS=$(curl -s -o "$TEAMS_TMP" -w '%{http_code}' "$FD_URL" \
  -H "X-Auth-Token: ${FOOTBALL_DATA_API_KEY}")

if [ "$FD_STATUS" != "200" ]; then
  echo "ERROR: football-data.org returned HTTP ${FD_STATUS}"
  cat "$TEAMS_TMP"
  exit 1
fi

TEAM_COUNT=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('teams', [])))" < "$TEAMS_TMP" 2>/dev/null || echo "?")
echo "Fetched ${TEAM_COUNT} teams. Importing into group ${GROUP_ID}..."

# Wrap the football-data.org response with the groupId the endpoint expects
PAYLOAD=$(python3 -c "
import sys, json
d = json.load(sys.stdin)
print(json.dumps({'groupId': ${GROUP_ID}, 'teams': d['teams']}))
" < "$TEAMS_TMP")

IMPORT_STATUS=$(echo "$PAYLOAD" | curl -s -o "$RESULT_TMP" -w '%{http_code}' -X POST "$IMPORT_URL" \
  -H "Authorization: Bearer ${SYNC_SECRET}" \
  -H "Content-Type: application/json" \
  --data @-)

if [ "$IMPORT_STATUS" != "200" ] && [ "$IMPORT_STATUS" != "201" ]; then
  echo "ERROR: import API returned HTTP ${IMPORT_STATUS}"
  cat "$RESULT_TMP"
  exit 1
fi

echo "Done: $(cat "$RESULT_TMP")"

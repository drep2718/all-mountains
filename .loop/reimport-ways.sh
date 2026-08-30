#!/usr/bin/env bash
# Re-import trail ways with the corrected query, then link trails to peaks.
# Relations are left alone — they were always imported correctly.
set -uo pipefail
cd "$(dirname "$0")/.."

LOG=".loop/ways-clean.log"; : > "$LOG"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }

URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2- | tr -d '"')
KEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2- | tr -d '"')

say "checking the database…"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
  "$URL/rest/v1/routes?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
[ "$CODE" = "200" ] || { say "✗ database answered $CODE"; exit 1; }

POLY=$(curl -s --max-time 20 "$URL/rest/v1/routes?select=poly&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
echo "$POLY" | grep -q "42703\|does not exist" && { say "✗ schema is not lean"; exit 1; }
say "✓ database up, schema lean"

# Refuse to start if the old ways are still there — importing over them would
# leave the mislabelled rows in place alongside the new ones.
OLD=$(curl -s --max-time 30 "$URL/rest/v1/routes?select=id&osm_id=lt.0&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Prefer: count=exact" \
  -D - -o /dev/null | grep -i content-range | sed 's|.*/||' | tr -d '\r\n ')
if [ "${OLD:-0}" -gt 0 ] 2>/dev/null; then
  say "✗ ${OLD} old ways still present. Purge them first:"
  say "    npx tsx --env-file=.env.local scripts/purge-ways.ts --yes"
  exit 1
fi
say "✓ old ways cleared"

for CC in CH JP US CA; do
  say "ways: $CC (path/footway, area-filtered, min 2 km)"
  if ! npx tsx --env-file=.env.local scripts/import-trail-ways.ts "$CC" --min-km 2 >> "$LOG" 2>&1; then
    say "✗ $CC failed — stopping (everything already imported stays)"
    exit 1
  fi
  say "   $CC done"
done

say "linking trails to peaks"
npx tsx --env-file=.env.local scripts/link-peaks.ts >> "$LOG" 2>&1 \
  || say "linking stopped early — re-run with --after <id>"

say "DONE — audit the result:"
say "    npx tsx --env-file=.env.local scripts/audit-data.ts"

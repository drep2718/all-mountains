#!/usr/bin/env bash
# Fill an empty database: peaks, then trails, then the peak↔trail links.
# Run after sql/fresh-schema.sql has been applied.
#
# Safe to re-run if it stops part-way — every import upserts on osm_id. Avoid
# running it repeatedly for no reason though: a re-upsert of an unchanged row
# still leaves a dead tuple, and that bloat is what filled the last database.
set -uo pipefail
cd "$(dirname "$0")/.."

LOG=".loop/bootstrap.log"; : > "$LOG"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }

COUNTRIES=(US CA CH JP)

URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2- | tr -d '"')
KEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2- | tr -d '"')

say "checking the database…"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 \
  "$URL/rest/v1/peaks?select=id&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
if [ "$CODE" != "200" ]; then
  say "✗ database answered $CODE, not 200."
  say "  Apply sql/fresh-schema.sql first, and check .env.local points at the right project."
  exit 1
fi
say "✓ database is up"

if ! grep -q "SUPABASE_SERVICE_ROLE_KEY" .env.local; then
  say "✗ SUPABASE_SERVICE_ROLE_KEY missing from .env.local — the importers need it."
  exit 1
fi

# This script is for an EMPTY database. Running it against a populated one
# re-upserts rows that already exist, and every one of those leaves a dead
# tuple — the bloat that filled the last database. Require --force to override.
PEAK_COUNT=$(curl -s --max-time 30 "$URL/rest/v1/peaks?select=id&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Prefer: count=exact" \
  -D - -o /dev/null 2>/dev/null | grep -i '^content-range' | sed 's|.*/||' | tr -d '\r\n ')

if [ "${PEAK_COUNT:-0}" -gt 1000 ] 2>/dev/null && [ "${1:-}" != "--force" ]; then
  say "✗ this database already holds ${PEAK_COUNT} peaks — it is not empty."
  say "  bootstrap.sh is for a fresh project. Re-importing over existing rows"
  say "  creates dead tuples, which is what filled the last disk."
  say ""
  say "  If the trails table needs rebuilding, use:  ./.loop/reimport-lean.sh"
  say "  To override anyway:                         ./.loop/bootstrap.sh --force"
  exit 1
fi

# --- 1. Peaks --------------------------------------------------------------
say ""
say "=== PEAKS ==="
for CC in "${COUNTRIES[@]}"; do
  say "peaks: $CC"
  if ! npx tsx --env-file=.env.local scripts/import-peaks.ts "$CC" >> "$LOG" 2>&1; then
    say "✗ peaks $CC failed — stopping"
    exit 1
  fi
done

# --- 2. Trail relations ----------------------------------------------------
# Waymarked long-distance routes: the smallest and most valuable set, so a
# failure later still leaves the app with good data.
say ""
say "=== TRAIL RELATIONS ==="
for CC in "${COUNTRIES[@]}"; do
  say "relations: $CC"
  if ! npx tsx --env-file=.env.local scripts/import-routes.ts "$CC" --all >> "$LOG" 2>&1; then
    say "✗ relations $CC failed — stopping"
    exit 1
  fi
done

# --- 3. Named trail ways ---------------------------------------------------
# 2 km floor drops connector fragments that dominated the row count without
# being trails anyone sets out to walk.
say ""
say "=== TRAIL WAYS (min 2 km) ==="
for CC in "${COUNTRIES[@]}"; do
  say "ways: $CC"
  if ! npx tsx --env-file=.env.local scripts/import-trail-ways.ts "$CC" --min-km 2 >> "$LOG" 2>&1; then
    say "✗ ways $CC failed — stopping (peaks and relations are already in)"
    exit 1
  fi
done

# --- 4. Link trails to peaks ----------------------------------------------
say ""
say "=== LINKING ==="
npx tsx --env-file=.env.local scripts/link-peaks.ts >> "$LOG" 2>&1 \
  || say "linking stopped early — safe to re-run with --after <id>"

say ""
say "DONE. Check the result:"
say "    ./.loop/status.sh"

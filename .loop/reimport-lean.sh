#!/usr/bin/env bash
# Lean re-import. Run AFTER sql/lean-schema.sql has been applied.
#
# Differences from the run that filled the disk:
#   * each country imported exactly ONCE — re-running upserts existing rows and
#     leaves a dead tuple behind every time, and that bloat outweighed the data
#   * ways filtered to >= 2 km, which drops connector fragments that dominated
#     the row count without being trails anyone sets out to walk
#   * countries run sequentially, so two importers never contend for the DB
#   * stops on the first failure instead of grinding on against a sick database
set -uo pipefail
cd "$(dirname "$0")/.."

LOG=".loop/reimport.log"; : > "$LOG"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }

# Refuse to start against a database that is not answering — the previous run's
# real damage was continuing to hammer one that had already fallen over.
say "checking the database is up…"
URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2- | tr -d '"')
KEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2- | tr -d '"')
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
  "$URL/rest/v1/routes?select=id&limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
if [ "$CODE" != "200" ]; then
  say "✗ database answered $CODE, not 200. Apply sql/lean-schema.sql first."
  exit 1
fi
say "✓ database is up"

# Relations first: the waymarked, named long-distance routes. Smallest and most
# valuable, so a failure part-way still leaves the app with good data.
for CC in CH JP CA US; do
  say "relations: $CC"
  if ! npx tsx --env-file=.env.local scripts/import-routes.ts "$CC" --all >> "$LOG" 2>&1; then
    say "✗ relations $CC failed — stopping"
    exit 1
  fi
done

# Then the individual named ways, at a 2 km floor.
for CC in CH JP CA US; do
  say "ways: $CC (min 2 km)"
  if ! npx tsx --env-file=.env.local scripts/import-trail-ways.ts "$CC" --min-km 2 >> "$LOG" 2>&1; then
    say "✗ ways $CC failed — stopping"
    exit 1
  fi
done

say "linking trails to peaks"
npx tsx --env-file=.env.local scripts/link-peaks.ts >> "$LOG" 2>&1 || say "linking stopped early (safe to re-run)"

say "DONE — check size in the dashboard before doing anything else"

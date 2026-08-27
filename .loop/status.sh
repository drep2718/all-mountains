#!/usr/bin/env bash
# What state is the database in, and what needs running next?
# Safe to run any time — it only reads.
set -uo pipefail
cd "$(dirname "$0")/.."

URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2- | tr -d '"')
KEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2- | tr -d '"')
H=(-H "apikey: $KEY" -H "Authorization: Bearer $KEY")

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red()   { printf '\033[31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }

bold "1. Is the database up?"
CODE=$(curl -s -o /tmp/am-status.json -w '%{http_code}' --max-time 25 \
  "$URL/rest/v1/peaks?select=id&limit=1" "${H[@]}")

if [ "$CODE" != "200" ]; then
  red "   ✗ answered $CODE — Postgres is not accepting connections yet"
  [ -s /tmp/am-status.json ] && sed 's/^/     /' /tmp/am-status.json && echo
  echo
  echo "   Wait for the restart to finish, then run this again."
  echo "   If it stays down: Dashboard → Settings → General → Restart project,"
  echo "   or reset the database (nothing in it is irreplaceable)."
  exit 1
fi
green "   ✓ up"
echo

# Exact row counts via PostgREST's Content-Range header.
count() {
  curl -s --max-time 30 "$URL/rest/v1/$1&limit=1" "${H[@]}" \
    -H "Prefer: count=exact" -D - -o /dev/null 2>/dev/null \
  | grep -i '^content-range' | sed 's|.*/||' | tr -d '\r\n '
}

bold "2. What data survived?"
PEAKS=$(count 'peaks?select=id')
ROUTES=$(count 'routes?select=id')
LINKS=$(count 'route_peaks?select=route_id')
printf '   peaks       %s\n' "${PEAKS:-unknown}"
printf '   trails      %s\n' "${ROUTES:-unknown}"
printf '   peak links  %s\n' "${LINKS:-unknown}"
echo

bold "3. Is the lean schema applied?"
# `poly` only exists after sql/lean-schema.sql has run.
POLY=$(curl -s --max-time 20 "$URL/rest/v1/routes?select=poly&limit=1" "${H[@]}")
if echo "$POLY" | grep -q "42703\|does not exist"; then
  LEAN=no
  red "   ✗ not yet — routes still has the old heavy columns"
else
  LEAN=yes
  green "   ✓ yes — routes.poly exists"
fi
echo

bold "NEXT STEP"
if [ "$LEAN" = "no" ]; then
  echo "   Open the Supabase SQL editor and run sql/lean-schema.sql,"
  echo "   section by section. Start with section 0 — it only measures."
  echo
  echo "   Print it to copy:   cat sql/lean-schema.sql"
elif [ "${ROUTES:-0}" -lt 1000 ] 2>/dev/null; then
  echo "   Schema is lean and trails are empty — re-import:"
  echo
  echo "       ./.loop/reimport-lean.sh"
  if [ "${PEAKS:-0}" -lt 1000 ] 2>/dev/null; then
    echo
    red  "   Peaks are missing too (the database was reset, not just restarted)."
    echo "   Import those first, one country at a time:"
    echo
    echo "       npx tsx --env-file=.env.local scripts/import-peaks.ts US"
    echo "       npx tsx --env-file=.env.local scripts/import-peaks.ts CA"
    echo "       npx tsx --env-file=.env.local scripts/import-peaks.ts CH"
    echo "       npx tsx --env-file=.env.local scripts/import-peaks.ts JP"
  fi
else
  green "   Nothing to run — schema is lean and trails are loaded."
  echo "   Start the app:   npm run dev"
fi

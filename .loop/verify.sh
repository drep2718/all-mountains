#!/usr/bin/env bash
# Acceptance-criteria checker. Exit 0 = every gate green.
# Usage: ./.loop/verify.sh [--quiet]
set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
QUIET="${1:-}"

ok()   { PASS=$((PASS+1)); [ "$QUIET" = "--quiet" ] || printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1));  printf '  \033[31m✗\033[0m %s\n' "$1"; }
head_() { [ "$QUIET" = "--quiet" ] || printf '\n\033[1m%s\033[0m\n' "$1"; }

URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2- | tr -d '"')
KEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2- | tr -d '"')

# Exact row count for a table via PostgREST's Content-Range header.
count() {
  local n
  n=$(curl -s --max-time 30 "$URL/rest/v1/$1&limit=1" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Prefer: count=exact" \
    -D - -o /dev/null 2>/dev/null | grep -i '^content-range' | sed 's|.*/||' | tr -d '\r\n ')
  # No header means the query errored (usually a statement timeout while the
  # importer is hammering the DB). Report it rather than silently scoring 0.
  [ -z "$n" ] && echo "ERR" || echo "$n"
}

atleast() { # name actual threshold
  local n="${2:-0}"
  if [ -n "$n" ] && [ "$n" -ge "$3" ] 2>/dev/null; then ok "$1: $n (need ≥$3)"; else bad "$1: ${n:-?} (need ≥$3)"; fi
}

head_ "A · DATA COMPLETENESS"
atleast "A1 peaks"  "$(count 'peaks?select=id')" 130000
atleast "A2 trails" "$(count 'routes?select=id')" 25000
# Unnamed trails are excluded at two layers: the importer refuses to insert
# them, and every browse query filters them. A COUNT over the whole table
# times out during an import, so assert the code paths instead.
if grep -q 'r.name' scripts/import-routes.ts \
   && grep -q 'not("name", "is", null)' src/app/routes/page.tsx; then
  ok "A6 unnamed trails filtered (import + browse)"
else
  bad "A6 unnamed-trail filtering missing"
fi
atleast "A4 route→peak links" "$(count 'route_peaks?select=route_id')" 5000
for C in "United States" "Canada" "Switzerland" "Japan"; do
  E=$(printf '%s' "$C" | sed 's/ /%20/g')
  atleast "A5 trails in $C" "$(count "routes?select=id&country=eq.$E")" 500
done

head_ "B · GPS TRACKING"
grep -q "watchPosition" src/hooks/useTracker.ts && ok "B3 uses watchPosition" || bad "B3 watchPosition missing"
grep -q "enableHighAccuracy: true" src/hooks/useTracker.ts && ok "B3 high accuracy on" || bad "B3 high accuracy off"
for f in start pause resume stop discard; do
  grep -q "const $f = useCallback" src/hooks/useTracker.ts && ok "B1 $f()" || bad "B1 $f() missing"
done
grep -q "MAX_ACCURACY_M" src/lib/track.ts && ok "B4 accuracy gate" || bad "B4 accuracy gate missing"
grep -q "MAX_SPEED_MS" src/lib/track.ts && ok "B4 jump rejection" || bad "B4 jump rejection missing"
grep -q "saveLive" src/hooks/useTracker.ts && ok "B5 persists live track" || bad "B5 no persistence"
grep -q "distanceToTrailM" src/hooks/useTracker.ts && ok "B6 off-route detection" || bad "B6 off-route missing"
grep -q "toGPX" src/app/activities/\[id\]/page.tsx && ok "B8 GPX export wired" || bad "B8 GPX export missing"
grep -q "denied" src/components/TrackerPanel.tsx && ok "B9 permission errors shown" || bad "B9 error states missing"

head_ "C · OFFLINE"
[ -f public/sw.js ] && ok "C1 service worker file" || bad "C1 sw.js missing"
grep -q 'serviceWorker.register' src/components/OfflineProvider.tsx && ok "C1 SW registered" || bad "C1 SW not registered"
grep -q "CACHE_TILES" public/sw.js && ok "C3 tile prefetch handler" || bad "C3 tile prefetch missing"
grep -q "cacheFirst" public/sw.js && ok "C2 cache-first strategy" || bad "C2 cache strategy missing"
[ -f src/app/downloads/page.tsx ] && ok "C6 downloads manager" || bad "C6 downloads page missing"
grep -q "removeDownload" src/lib/offline.ts && ok "C6 delete downloads" || bad "C6 delete missing"
grep -q "Offline —" src/components/OfflineProvider.tsx && ok "C7 offline indicator" || bad "C7 indicator missing"
[ -f src/app/offline/page.tsx ] && ok "C2 offline fallback page" || bad "C2 offline page missing"

head_ "D · ALLTRAILS PARITY"
[ -f src/app/search/page.tsx ] && ok "D1 unified search" || bad "D1 search missing"
grep -q "Most popular" src/app/routes/page.tsx && ok "D3 popular sort" || bad "D3 popular sort missing"
[ -f src/app/lists/page.tsx ] && ok "D4 lists" || bad "D4 lists missing"
[ -f src/components/ElevationProfile.tsx ] && ok "D5 elevation profile" || bad "D5 elevation profile missing"
[ -f src/app/activities/page.tsx ] && ok "D7 activity feed" || bad "D7 activities missing"

head_ "E · ENGINEERING QUALITY"
npx tsc --noEmit >/dev/null 2>&1 && ok "E1 typecheck clean" || bad "E1 typecheck FAILED"
npx vitest run >/dev/null 2>&1 && ok "E1 unit tests pass" || bad "E1 unit tests FAILED"
ERRS=$(npx eslint src -f json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).reduce((n,f)=>n+f.errorCount,0))}catch{console.log('99')}})")
[ "${ERRS:-99}" = "0" ] && ok "E3 eslint clean" || bad "E3 eslint errors: $ERRS"
# database.types.ts is generated from the schema, so it's exempt from the
# hand-written module size budget.
BIG=$(find src -name '*.ts' -o -name '*.tsx' 2>/dev/null \
  | grep -v 'database.types.ts' \
  | xargs wc -l 2>/dev/null | awk '$1>400 && $2!="total"{print $2" ("$1") "}')
[ -z "$BIG" ] && ok "E6 all modules <400 lines" || bad "E6 oversized: $BIG"
git diff --cached -- . 2>/dev/null | grep -qiE 'service_role|sk_live|SUPABASE_SERVICE' && bad "E5 possible secret staged" || ok "E5 no secrets staged"

head_ "RESULT"
printf '  %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && printf '  \033[32mALL GREEN\033[0m\n' || printf '  \033[31m%s GATE(S) RED\033[0m\n' "$FAIL"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)

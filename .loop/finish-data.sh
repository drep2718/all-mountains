#!/usr/bin/env bash
# Runs the remaining data work once the ways import finishes.
#
# Order matters:
#   1. wait for the ways import to exit
#   2. re-import route relations, now that super-relations resolve (fixes the
#      Appalachian Trail and friends importing as 0.1 km stubs)
#   3. link routes to the peaks they pass, in chunks
set -uo pipefail
cd "$(dirname "$0")/.."

LOG=".loop/finish.log"; : > "$LOG"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }

say "waiting for ways import to finish…"
while pgrep -f "import-trail-ways" > /dev/null; do sleep 60; done
say "ways import done"

say "re-importing route relations with super-relation resolution"
for CC in US CH JP CA; do
  say "  relations: $CC"
  npx tsx --env-file=.env.local scripts/import-routes.ts "$CC" --all >> "$LOG" 2>&1
  say "  relations: $CC rc=$?"
done

say "linking routes to peaks"
npx tsx --env-file=.env.local scripts/link-peaks.ts >> "$LOG" 2>&1
say "linking rc=$?"

say "final verification"
./.loop/verify.sh >> "$LOG" 2>&1
say "verify rc=$?"
say "ALL DATA WORK COMPLETE"

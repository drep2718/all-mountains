#!/usr/bin/env bash
# Full trail import for the designated regions ONLY (US, CA, CH, JP).
# Never pass ALL. Runs sequentially so Overpass mirrors aren't hammered.
set -uo pipefail
cd "$(dirname "$0")/.."

LOG=".loop/import.log"
: > "$LOG"

echo "=== TRAIL IMPORT START $(date) ===" | tee -a "$LOG"

# Smallest first so we get early signal that the pipeline works end to end.
for CC in CH JP CA US; do
  echo "" | tee -a "$LOG"
  echo "### $CC $(date +%H:%M:%S) ###" | tee -a "$LOG"
  # --all = every hiking route, not just iwn/nwn/rwn waymarked networks
  npx tsx --env-file=.env.local scripts/import-routes.ts "$CC" --all >> "$LOG" 2>&1
  echo "### $CC done rc=$? $(date +%H:%M:%S) ###" | tee -a "$LOG"
done

echo "=== TRAIL IMPORT COMPLETE $(date) ===" | tee -a "$LOG"

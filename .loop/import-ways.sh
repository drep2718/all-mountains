#!/usr/bin/env bash
# Named trail ways for the designated regions only.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=".loop/ways.log"; : > "$LOG"
echo "=== WAYS IMPORT START $(date) ===" | tee -a "$LOG"
for CC in CH JP CA US; do
  echo "### $CC $(date +%H:%M:%S) ###" | tee -a "$LOG"
  npx tsx --env-file=.env.local scripts/import-trail-ways.ts "$CC" --min-km 0.5 >> "$LOG" 2>&1
  echo "### $CC done $(date +%H:%M:%S) ###" | tee -a "$LOG"
done
echo "=== WAYS IMPORT COMPLETE $(date) ===" | tee -a "$LOG"

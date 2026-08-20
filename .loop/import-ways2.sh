#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=".loop/ways2.log"; : > "$LOG"
echo "=== WAYS RETRY (CA, US) $(date) ===" | tee -a "$LOG"
for CC in CA US; do
  echo "### $CC $(date +%H:%M:%S) ###" | tee -a "$LOG"
  npx tsx --env-file=.env.local scripts/import-trail-ways.ts "$CC" --min-km 0.5 >> "$LOG" 2>&1
  echo "### $CC done $(date +%H:%M:%S) ###" | tee -a "$LOG"
done
echo "=== COMPLETE $(date) ===" | tee -a "$LOG"

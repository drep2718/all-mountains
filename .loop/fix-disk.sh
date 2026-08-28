#!/usr/bin/env bash
# Free the disk on a Supabase project stuck in read-only mode.
#
#   ./.loop/fix-disk.sh "postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres"
#
# Use the DIRECT connection string (port 5432), not the pooler (6543).
# The SQL editor and the pooler both run in transaction mode, which discards
# session settings between statements — which is why
# `set default_transaction_read_only = 'off'` had no effect there. A direct
# connection keeps one session for the whole script, so the override holds.
#
# The connection string contains your password. It is passed straight to psql
# and never echoed or written to the log.
set -uo pipefail
cd "$(dirname "$0")/.."

CONN="${1:-}"
if [ -z "$CONN" ]; then
  echo "usage: ./.loop/fix-disk.sh \"<direct connection string, port 5432>\""
  echo
  echo "Find it in: Dashboard → Settings → Database → Connection string → URI"
  echo "Make sure the port is 5432 (direct), not 6543 (pooler)."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install it with:"
  echo "    brew install libpq && brew link --force libpq"
  exit 1
fi

case "$CONN" in
  *:6543/*)
    echo "✗ That is the pooler port (6543). Session settings do not persist there,"
    echo "  which is the reason this has been failing. Use the direct string (5432)."
    exit 1
    ;;
esac

echo "=== before ==="
psql "$CONN" -qAt -c "
  select 'database: ' || pg_size_pretty(pg_database_size(current_database()));
  select 'routes:   ' || pg_size_pretty(pg_total_relation_size('public.routes'));
" || { echo "✗ could not connect"; exit 1; }

echo
echo "Dropping public.routes to reclaim the space."
echo "Peaks are NOT touched. Trails are re-importable from OpenStreetMap."
read -r -p "Continue? [y/N] " ok
[ "$ok" = "y" ] || { echo "aborted"; exit 1; }

# One session, so the read-write override applies to everything after it.
# DROP rather than DELETE: DELETE writes a WAL record per row and needs free
# space this volume does not have, while DROP simply unlinks the files.
# The table is recreated in its lean shape by sql/fresh-schema.sql.
psql "$CONN" -v ON_ERROR_STOP=1 <<'SQL'
set default_transaction_read_only = 'off';
begin;
set transaction read write;
drop table if exists public.route_peaks;
drop table if exists public.routes cascade;
commit;
SQL
rc=$?

if [ $rc -ne 0 ]; then
  echo
  echo "✗ still refused. The flag is enforced above the session —"
  echo "  Supabase support or a temporary Pro upgrade is the remaining path."
  exit 1
fi

echo
echo "=== after ==="
psql "$CONN" -qAt -c "
  select 'database: ' || pg_size_pretty(pg_database_size(current_database()));
"

echo
echo "Space reclaimed. Next:"
echo "  1. Recreate the lean tables — paste sql/fresh-schema.sql into the SQL editor."
echo "     (It is create-if-not-exists throughout, so it only adds what is missing"
echo "      and leaves your peaks alone.)"
echo "  2. Re-import trails:  ./.loop/reimport-lean.sh"

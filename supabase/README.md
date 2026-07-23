# Database as code (Supabase migrations)

The schema used to live only in the Supabase dashboard (ad-hoc SQL Editor). It's now
**defined in code** under `supabase/migrations/`. Every change is a versioned `.sql`
file, reviewed in git and applied with one command — no more hand-pasting SQL.

Project ref: **`zvmgniunhxxfnmlayxdk`** (us-east-1).

## One-time setup (do this once)

```bash
supabase login                                   # opens browser, authorizes the CLI
supabase link --project-ref zvmgniunhxxfnmlayxdk # connects this repo to your project
                                                 # (asks for the DB password once)
```

## Baseline: already captured ✅

`migrations/00000000000000_baseline.sql` is your **entire live schema** (all tables,
RPCs, RLS, triggers), dumped from the DB and marked as already-applied. Both it and the
`saved_lists` migration show `local == remote` in `supabase migration list`. The DB is
now fully defined in code.

> Note: `supabase db pull` currently fails on CLI 2.109 with a `pgdelta` certificate
> error. The reliable way to (re)capture the live schema is `db dump`:
> ```bash
> supabase db dump --linked -f supabase/migrations/<timestamp>_baseline.sql
> supabase migration repair --status applied <timestamp>   # mark it applied on remote
> ```

## Apply new changes going forward

New feature migrations (like `20260722000100_saved_lists.sql`, which added `list_items`)
are applied with:

```bash
supabase db push        # applies any not-yet-applied migrations to the live DB
```

## Day-to-day: making a schema change

```bash
supabase migration new add_something      # creates an empty timestamped .sql
# ...write your SQL in the new file...
supabase db push                          # applies it to the linked project
```

To keep the TypeScript types in sync with the DB (replaces hand-written interfaces):

```bash
supabase gen types typescript --linked > src/lib/database.types.ts
```

## Local development (optional, needs Docker)

```bash
supabase start          # spins up a full local Postgres + Studio
supabase db reset       # rebuilds it from migrations/ (great for testing them)
```

## Rules
- **Never edit the schema in the dashboard again** — write a migration instead, so code
  stays the source of truth.
- One logical change per migration; migrations are append-only (don't edit applied ones).
- Migrations are idempotent where possible (`create ... if not exists`, `drop policy if exists`).

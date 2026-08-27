# Recovery — database full

Read this before `RUNBOOK.md`.

## What happened

The overnight import took `routes` from 2,486 rows to ~139,000, and each row
carried a GeoJSON `geometry`, a PostGIS `path` geography derived from it, and a
`tags` blob. Measured on real trails, that is ~185 MB of live data.

That alone would have fitted. What broke it was the writes: **~17,200 batch
upserts, with the US imported three times and CA/CH/JP twice each.** Every
re-import upserts rows that already exist, and each one leaves a dead tuple
behind. Autovacuum could not keep up under sustained write load. The bloat
outgrew the data and filled the volume, and Postgres will not start on a full
disk — hence `57P03: the database system is not accepting connections`.

Two mistakes, both mine: importing without checking the quota, and leaving
`link-peaks.ts` retrying every two seconds for thirteen hours against a
database that had already fallen over.

## Fix, in order

### 1. Get Postgres to start

Free tier has no disk resize, so:

1. **Restart the project** — Dashboard → Settings → General → Restart project.
2. If it will not come back, **reset the database**. Everything in it is
   re-importable from OpenStreetMap, and `peak_lists` / `list_items` are empty —
   confirmed. Nothing irreplaceable is lost.
3. Failing both, open a Supabase support ticket; disk lockouts on Free are a
   known case.

Check progress with:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/routes?select=id&limit=1" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

`200` means it is back. `503` means PostgREST is up but Postgres still is not.

### 2. Apply the lean schema

In the SQL editor, run **`sql/lean-schema.sql`**, section by section. Section 0
only measures — if `routes` is not the largest table, stop and say so, because
then this diagnosis is wrong.

It truncates `routes` (reclaims the file immediately, unlike DELETE), drops
`geometry`, `path` and `tags`, adds a single `poly` text column plus the six tag
fields the UI actually reads, moves `routes_in_bounds` off PostGIS onto the
already-indexed `bbox_*` columns, and creates the indexes the browse sorts need.

### 3. Re-import

```bash
./.loop/reimport-lean.sh
```

It refuses to start unless the database answers `200`, imports each country
**once**, and stops on the first failure instead of grinding on.

## What changes, and what it costs

Verified against real OSM trails with `scripts/dryrun-import.ts` — no database
required, which is how it was checked while Postgres was down:

| | Before | After |
|---|---|---|
| Bytes per trail | 807 | 31 |
| Projected at 139k rows | 112 MB | **4.3 MB** |
| Worst point deviation | — | **10.1 m** |
| Decode failures | — | 0 |

Geometry is stored as a Google-encoded polyline, simplified to ~11 m — narrower
than a trail corridor at any zoom you would hike at. Decoding is a tight loop
over a short string, so pages get **faster**, not slower: less data over the
wire and no server-side work.

The `--min-km 2` floor on ways drops connector fragments that dominated the row
count without being trails anyone sets out to walk. Expect roughly 40–50k
trails rather than 139k, and a database comfortably inside Free.

## What stops this recurring

- `link-peaks.ts` now gives up after 6 consecutive failures with exponential
  backoff, exits non-zero, and prints a `--after <id>` to resume. It no longer
  treats a dead database as a reason to try harder.
- `.loop/reimport-lean.sh` health-checks before starting and imports each
  country exactly once.
- `scripts/measure-storage.ts` sizes any schema change against real data before
  it is loaded.

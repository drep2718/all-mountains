# Morning runbook

Everything below was built and verified overnight. Two things need **you**,
because they require database privileges I don't have.

---

## 1. Run these two SQL files (5 minutes) — do this first

Open **Supabase → SQL Editor**, paste each file, Run.

### a) `sql/performance-indexes.sql` — **urgent**

The trail import took `routes` from ~2,500 rows to 90,000+. The browse queries
sort on columns with no index, so Postgres full-scans the table on every
request. Measured against the live database after the import:

| Query | Before |
|---|---|
| `order by distance_km desc limit 24` | **times out (HTTP 500)** |
| `order by est_time_min desc limit 24` | **times out (HTTP 500)** |
| `name ilike '%Ridge%'` | 2.5 s |
| peaks by `is_iconic, prominence` | 2.2 s |

Until this runs, the **Trails page "Longest" and "Most time" sorts are broken**.
Everything else works. This is the single highest-value thing to run.

> The file uses `CREATE INDEX CONCURRENTLY` so the app stays up while indexes
> build. If your editor wraps statements in a transaction, run them one at a
> time or drop the `CONCURRENTLY` keyword.

### b) `sql/reviews.sql` — enables reviews

Creates the reviews table, RLS policies, and the aggregate-rating views. Trail
and peak pages already render a full reviews UI; until this runs it shows
"No reviews yet" and quietly ignores the missing table.

### Optional: `sql/canonical-summits.sql`

From the earlier session — adds clean rows for famous summits the OSM import
mislabels (Rainier is stored as "Columbia Crest"; Shasta/Baker/Adams/St Helens
are missing by name), and seeds the **Beginner Hikes** list. Sign in first, as
the list is owned by your account.

---

## 2. What was built

### Trail data: 2,486 → 86,000+ (still importing)

| Source | Result |
|---|---|
| Hiking **route relations**, all networks | 24,428 |
| Named **trail ways** (path/footway/track/bridleway) | 62,000+ and climbing |

Route relations are only long-distance waymarked networks. Most of what people
actually walk — and what AllTrails lists — is an individual named way, so both
are now imported. Regions kept to **US, CA, CH, JP** as agreed.

Three importer bugs fixed along the way:
- **Batches silently dropped.** Trail geometry plus the PostGIS trigger blew the
  statement timeout at batch size 200, losing whole batches. Now halves the
  batch and retries.
- **Whole countries silently lost.** Overpass answers HTTP 200 with a `remark`
  when a query times out, returning zero elements — read as "no trails here".
  That cost the entire first US and Canada run. Now forces a subdivide.
- **Long trails imported as stubs.** The Appalachian Trail is a *super-relation*
  whose members are other relations carrying no geometry, so it imported as
  "0.1 km". Child relations are now resolved and spliced in.

### GPS tracking (`/record`)

Start / pause / resume / finish, with live distance, time, ascent, and pace.

The parts that matter on a mountain:
- **Noise gates.** Without them a stationary phone accumulates phantom
  kilometres. Fixes are rejected on poor accuracy, sub-jitter movement,
  and implausible speed; elevation only counts past a threshold.
- **Crash recovery.** The track is written to the device on every accepted fix.
  *Verified*: killed a 40-point recording and reloaded — all 40 points, 2.17 km
  and 156 m ascent restored intact.
- **Off-route warning** via point-to-polyline distance when you start from a
  trail page.
- **GPX export** of any recorded hike.
- 42 unit tests cover the math. They caught a real bug: the first point's
  elevation was ignored, so the opening climb of every hike was dropped.

### Offline maps (`/downloads`)

Per-trail download with live progress and size, a downloads manager, and an
offline banner. *Verified*: downloaded a trail, then confirmed a cached tile was
a valid 220 KB PNG served at HTTP 200 with the trail's own data alongside it.

One bug worth knowing about, because it would have been invisible: the first
version cached app code **cache-first**, which pins every user to the build they
first loaded — they would never receive updates, including fixes to this GPS and
offline code. It is now stale-while-revalidate, and the worker is not registered
in development at all.

### AllTrails parity added tonight
- Elevation profile on trail pages (honest "no data" when OSM has no Z values,
  rather than a fabricated curve)
- Reviews, star ratings, trail conditions
- Directions to trailhead (Apple or Google Maps by platform)
- Activity feed of recorded hikes

---

## 3. The loop harness

```bash
./.loop/verify.sh
```

39 mechanical checks across data, GPS, offline, parity, and code quality.
Criteria are in `.loop/ACCEPTANCE.md`. Last run: **39 passed, 0 failed**.

Quality gates: `tsc` clean, `next build` passes, **ESLint 17 errors → 0**,
42 tests green, every module under 400 lines.

---

## 4. Still running / worth doing next

- **Imports may still be running.** Check `tail -f .loop/ways2.log`. Canada and
  the US are re-running after the Overpass fix.
- **Link trails to peaks.** `scripts/link-peaks.ts` walks routes in chunks and
  links them via bounding box. Run it *after* the imports finish and *after*
  the indexes exist — it is DB-heavy:
  ```bash
  npx tsx --env-file=.env.local scripts/link-peaks.ts
  ```
- **Verify offline against a production build** (`next build && next start`).
  The service worker is dev-disabled by design, so the end-to-end offline path
  is best confirmed in production mode.
- Not built: photo uploads, social/following, wrong-turn *audio* alerts,
  Strava/Garmin sync.

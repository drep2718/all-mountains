# Parallel work while the route import runs

Handoff brief. Written 2026-11-19, with the route importer at ~860/1032 peaks.

Repo: `~/PROJECTS/All Mountains/all-mountains` · `origin/main` at `de36f24`, everything pushed.

---

## Before you touch anything

A background job is appending to two files. **Do not edit, delete, reformat or
commit these:**

```
data/catalogue/routes.ndjson        ← being appended to right now
data/catalogue/routes-done.ndjson   ← the resume log
```

**Do not run a second copy of `scripts/catalogue/import-routes.ts`.** Check first:

```bash
pgrep -f "catalogue/import-routes" && echo RUNNING || echo "finished — see task 0"
```

Everything else in the repo is free. `src/`, `sql/`, `docs/`, the other scripts,
and `data/curated-peaks.json` are all safe to work on.

Verify before and after any change:

```bash
npx tsc --noEmit && npx eslint src --ext .ts,.tsx && npx vitest run && npx next build
```

Current baseline: **0 type errors, 0 lint errors, 102 tests passing, build green.**
Do not hand back anything that regresses that.

---

## Task 0 — when the import finishes (do this first if it has)

```bash
npx tsx --env-file=.env.local scripts/catalogue/load-catalogue.ts
npx tsx scripts/catalogue/audit-catalogue.ts
```

The loader is idempotent — running it twice changes nothing. The audit must print
`PASS`. If the importer died early, resume it (it skips what is done):

```bash
npx tsx scripts/catalogue/import-routes.ts
```

---

## Task 1 — `/explore` is broken (highest value, ~1 hour)

A main nav item renders an empty map. Both its RPC calls fail and both failures
are swallowed.

**Evidence** (run it yourself):

```bash
URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2- | tr -d '"')
KEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.local | cut -d= -f2- | tr -d '"')
curl -s -X POST "$URL/rest/v1/rpc/peaks_in_bounds" -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"min_lat":46,"min_lng":-122,"max_lat":47,"max_lng":-121,"min_elevation":0,"lim":400}'
```

Returns `PGRST202 … no matches were found in the schema cache`.

Two separate problems in `src/app/explore/page.tsx` around line 92:

1. `peaks_in_bounds` is called with `min_elevation` and `lim`. The function in
   `sql/peaks-first-schema.sql:255` takes `(min_lat, min_lng, max_lat, max_lng,
   max_rows)`. The correct call returns HTTP 200.
2. `routes_in_bounds` **no longer exists** — it was dropped in the migration,
   because routes now belong to a peak and are fetched by `peak_slug`.

Fix: use `max_rows`; replace the `routes_in_bounds` call with a query on
`routes` filtered by the `peak_slug`s already on screen (see `searchAll()` in
`src/lib/search.ts`, which does exactly this). Then **surface the error** rather
than swallowing it — the pattern that hid this is

```ts
if (!peakRes.error && peakRes.data) setPeaks(...)   // ← failure is invisible
```

`minElevationForZoom()` becomes dead once `min_elevation` is gone; either delete
it or push the filter into the query.

---

## Task 2 — the other unverified pages (~2 hours)

I migrated 14 files from numeric peak ids to slugs and verified these in a
browser: `/peaks`, `/peaks/[slug]`, `/logbook`, `/record`, `/downloads`.

**These compile but were never opened:**

```
/search   /lists   /lists/[id]   /routes   /routes/[id]   /profile   /activities   /activities/[id]
```

Typecheck passing means little here — the whole class of bug in Task 1 is a
*runtime* mismatch that compiles fine. Open each one, watch the console, fix
what breaks. Look especially for: old column names (`elevation` vs
`elevation_m`), `peak_id` vs `peak_slug`, and dropped RPCs.

```bash
npm run dev     # http://localhost:3000
```

---

## Task 3 — verify one unverified fix (~15 min)

My last commit changed `public/sw.js` to broadcast `CACHE_DONE` with
`{ includeUncontrolled: true }`. I ran out of budget before re-testing it.

**Symptom if it is still wrong:** the Download button sticks on "Downloading…"
forever even though every tile is cached.

```bash
npx next build && npm run start          # port 3001 — the SW is production-only
```

Open `/peaks/mount-whitney-united-states` in a **fresh tab**, scroll to the map,
hit Download, and watch for "✓ Available offline".

Two things that will waste your time if you do not know them:

- The service worker is only registered in production (`OfflineProvider.tsx:32`).
  Dev will never exercise this.
- Mapbox GL leaks WebGL contexts across reloads. After roughly a dozen reloads
  in one tab, every new map silently renders blank with no error. **Open a fresh
  tab** before concluding a map is broken — this cost me several wrong diagnoses.

---

## Task 4 — download size (~1 hour)

Mount Whitney costs ~41 MB because it caches both map styles at `@2x`. The
estimate is honest now but the number is high.

`src/lib/offline.ts`, `OFFLINE_STYLES`. Options, cheapest first:

- `@1x` instead of `@2x` — roughly a third of the bytes, slightly soft on retina
- one style only (satellite is the 3-D default; topo is what navigation uses, so
  check both still render before dropping either)
- trim zoom 15, which is the bulk of the tiles (`planMountainTiles` in `tiles.ts`)

Measured tile sizes are in `TILE_BYTES` in `src/lib/mapStyle.ts`: satellite
323 KB, outdoors 248 KB, DEM 168 KB. Re-measure if you change the suffix —
**do not guess**, a flat 25 KB assumption is what produced the original
"3.4 MB" lie for a 54.7 MB download.

---

## Task 5 — deploy (~30 min)

Vercel is still serving the **pre-pivot build** — `all-mountains.vercel.app`
currently renders its filter chrome and zero peaks. The database behind it is
now correct, so a deploy should light it up.

Confirm the env vars on Vercel match `.env.local`, then deploy. The project is
linked: `prj_yFZtvihUmGEQ5DmOqLNO0p4zHhyG`, team `team_8EPF9ZhTgGA63Pp04ZB2cdz8`.
Note the Vercel MCP tools returned 403 for that scope and needed
`authorize_team_access`.

---

## Task 6 — more peaks (~2 hours, mostly unattended)

`data/curated-peaks.json` has 1,032 peaks across 3 continents and 40 countries.
**Missing entirely:** South America, Africa, Oceania, South Asia, and Canada.
Of the Seven Summits it has only Everest, Denali and Elbrus.

Add entries to `data/curated-peaks.json` in the existing shape (`id` is a slug:
lowercase, hyphens, must match `^[a-z0-9]+(-[a-z0-9]+)*$` or the schema CHECK
rejects it), then:

```bash
npx tsx scripts/catalogue/enrich-peaks.ts --only slug-one,slug-two
npx tsx scripts/catalogue/backfill-hero-photos.ts
npx tsx scripts/catalogue/audit-catalogue.ts
```

Safe to run alongside the route importer — enrichment writes `peaks.ndjson` and
`photos.ndjson`, not the routes files. Use `--only`, never a bare run, or you
will re-enrich all 1,032.

Suggested: ~40 Canadian summits (Robson, Assiniboine, Temple, Garibaldi), the
four missing Seven Summits, Patagonia, the Himalaya beyond the six Tibetan peaks.

---

## Task 7 — `src/lib/terrain.ts` has no tests (~1 hour)

It is the most consequential untested module in the repo: every ascent figure,
grade, time estimate and hazard on the peak page comes out of it. `navigation.ts`
next door has 19 tests — follow that file's shape.

Worth covering, because each one is a bug I actually hit:

- `resample()` spacing on a line with clustered vertices
- the 5-point median in `denoise()` — feed it a spiky synthetic DEM and assert
  the invented ascent disappears
- the 2 m threshold: a long gentle climb must count, jitter must not
- `estimateMinutes()` scaling by difficulty, and Langmuir's descent correction
- `assessHazards()` at band boundaries (2500/3500/5000 m) and across the
  northern/southern winter switch

`profileFromTerrain()` needs a fake map object with a `queryTerrainElevation`
that returns from a fixture array; returning `null` must make it return `null`
rather than a flat profile.

---

## Things that are done — do not redo them

- The catalogue, schema and migration. **Never** re-run a bulk import against
  the database; `load-catalogue.ts` is the only thing that should write to it.
- The old pipeline was deleted on purpose (`0b0c382`) — those scripts are what
  filled the disk and took the database read-only. Do not restore them from
  history.
- 3-D terrain, measured profiles, hazards, navigation guidance, the summit map
  with globe/flat, offline download. All verified; see `docs/PIVOT-PLAN.md` for
  the execution log, including four places the original plan was wrong.

## Conventions

- Commit messages: plain imperative sentences with a body explaining *why*, no
  conventional-commits prefix. See `git log`.
- Never commit `.env.local`.
- Light theme only — there is no dark palette. `text-amber-300` on
  `bg-amber-900/15` renders as pale-on-pale; use dark text on a light tint.
- React 19 lint forbids `setState` directly inside an effect. For localStorage,
  use `useLocalStore` (`useSyncExternalStore`), which already exists.
- Supabase **rejects** when the host is unreachable and also returns a resolved
  result carrying `error`. Handle both, or a page spins forever or reports an
  unreachable database as an empty one.

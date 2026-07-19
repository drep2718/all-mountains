# All Mountains — Global Data Import Runbook

Everything needed to load the whole world's peaks + trails yourself.
Run all commands from the project root:
`cd "/Users/aidendrep/PROJECTS/All Mountains/all-mountains"`

Total time: ~3–5 hours (mostly waiting on the OpenStreetMap servers).
It's safe to stop and re-run — imports `upsert` on `osm_id`, so nothing duplicates.

---

## STEP 1 — Global peaks (~1.2M peaks, ~2–3 hrs)

```bash
npx tsx --env-file=.env.local scripts/import-peaks.ts ALL
```

- Loops through ~195 countries, fetching every `natural=peak` from OSM.
- Prints progress per country (`Inserted 500/9020 …`).
- If a country errors (Overpass timeout), it waits 15s and moves on — that
  country just gets skipped; re-run later to fill gaps.
- **To run one region instead:** pass country codes, e.g.
  `... scripts/import-peaks.ts "US,CA,MX"` or `"FR,IT,CH,AT"` (the Alps).

**Tip — run it in the background so it survives:**
```bash
nohup npx tsx --env-file=.env.local scripts/import-peaks.ts ALL > peaks-import.log 2>&1 &
tail -f peaks-import.log        # watch progress; Ctrl-C to stop watching (import keeps going)
```

---

## STEP 2 — Global trails (per continent, ~1–2 hrs)

Routes are heavier (full geometry), so import in country batches rather than ALL.
Copy/paste each line; let each finish before the next.

```bash
# Europe (biggest trail network)
npx tsx --env-file=.env.local scripts/import-routes.ts "FR,IT,CH,AT,DE,ES,GR,NO,SE,GB,PL,SI,SK,RO,BG,HR"
# North America
npx tsx --env-file=.env.local scripts/import-routes.ts "US,CA,MX"
# Rest / add as you like
npx tsx --env-file=.env.local scripts/import-routes.ts "JP,NZ,AU,CL,AR,NP,IN,ZA"
```

Each run ends by trying to link routes→peaks and will likely print
`canceling statement due to statement timeout` — that's expected, Step 3 fixes it.

---

## STEP 3 — Link every trail to the peaks it crosses

The auto-link inside the import times out at global scale. Run it manually in the
**Supabase SQL Editor** (it allows a long timeout there):

```sql
SET statement_timeout = '1200s';   -- 20 minutes
SELECT link_route_peaks(500);      -- links peaks within 500m of each trail's path
```

Returns `NULL` = success. Re-run any time after adding more routes.

---

## STEP 4 — Fill in route type + estimated time (instant)

Run once in the **Supabase SQL Editor** after new route imports:

```sql
UPDATE routes SET route_type = CASE
  WHEN path IS NULL THEN NULL
  WHEN ST_Distance(
    ST_StartPoint(ST_GeometryN(path::geometry, 1))::geography,
    ST_EndPoint(ST_GeometryN(path::geometry, ST_NumGeometries(path::geometry)))::geography
  ) < 500 THEN 'Loop' ELSE 'Out & Back' END
WHERE route_type IS NULL;

UPDATE routes SET est_time_min = ROUND(
  COALESCE(distance_km,0) * 12 + COALESCE(ascent_m,0)/100.0 * 10
)::int
WHERE est_time_min IS NULL AND distance_km IS NOT NULL;
```

(The updated import script now computes these automatically, so this is only
needed for routes imported before that change.)

---

## Photos — already handled, nothing to run

Every trail gets a live map-image thumbnail generated from its geometry via the
Mapbox Static Images API (`src/lib/staticMap.ts`). No photo backfill or storage
needed. Peaks show a placeholder until an optional Wikipedia/Wikimedia photo
backfill is added later.

---

## Checking progress / totals

Run in the Supabase SQL Editor any time:
```sql
SELECT
  (SELECT count(*) FROM peaks)       AS peaks,
  (SELECT count(*) FROM routes)      AS routes,
  (SELECT count(*) FROM route_peaks) AS trail_peak_links;
```

Watch the DB size in Supabase → Home. Free tier = 500 MB. ~1.2M peaks +
worldwide routes should fit, but if you approach the cap, import fewer countries
or upgrade to Pro ($25/mo, 8 GB).

---

## If something breaks

- **All Overpass mirrors failed / 504s:** the OSM servers are busy. Wait 30–60 min
  and re-run — upserts skip what's already imported.
- **`supabaseUrl is required`:** you forgot `--env-file=.env.local`.
- **Import feels stuck:** big countries (US, FR) can take several minutes on one
  Overpass query before printing `Found N …`. That's normal.
- **Resume after a crash:** just re-run the same command; done rows are skipped.

---

## Optional future enrichment (needs a new script — ask Claude next session)

- **Features filter data** (Waterfalls / Views / Lakes near a trail): a script
  that queries OSM `natural=waterfall`, `tourism=viewpoint`, `natural=water`
  near each route path and tags it.
- **Activities** (Walking / Biking / Running): import `route=foot`,
  `route=bicycle`, `route=running` relations the same way as hiking.
- **Peak photos:** backfill from the Wikipedia/Wikimedia API using each peak's
  `wikipedia_url`.

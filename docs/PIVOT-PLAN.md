# All Mountains — the peaks-first pivot

**Written 2026-11-18.** Plan of record for turning the app from an AllTrails clone with
134,531 peaks and 66,331 trails into a mountain-first app built on ~1,032 curated summits,
with offline navigation and a personal summit map.

---

## 0. Where we actually are

### 0.1 The blocker you have to clear first

The Supabase project in `.env.local` **no longer exists**:

```
zvmgniunhxxfnmlayxdk.supabase.co     → NXDOMAIN
db.zvmgniunhxxfnmlayxdk.supabase.co  → NXDOMAIN
api.supabase.com                     → resolves (so this is not a network fault)
```

A *paused* project still resolves. NXDOMAIN means deleted — most likely reclaimed after
sitting paused on the free tier following the disk-full incident. Every table is gone:
peaks, routes, route_peaks, summit_logs, lists, reviews, profiles.

This is the only step in this plan I cannot do for you — it needs your Supabase account.
And it is good news for this particular pivot: we were going to delete 99% of that data
anyway. There is nothing to migrate and no 1.6 GB of bloat to dig out.

### 0.2 What works today, in code

The app is in better shape than the data. None of this is lost — it is all committed
except where noted.

| Area | State | Files |
|---|---|---|
| **Tile math** | Done, tested. Slippy-map XYZ, bbox padding, tile enumeration, size estimates | `src/lib/tiles.ts`, `tiles.test.ts` |
| **Offline download** | Works. Plans tiles z10–14 with 3 km pad, talks to the SW with progress, falls back to direct Cache API, caches the trail page **and** its `/_next/` chunks off the Performance timeline, localStorage index, reference-counted tile deletion | `src/lib/offline.ts` |
| **Service worker** | v3, three cache tiers. Shell = stale-while-revalidate, tiles = cache-first and **unversioned on purpose** so updates never delete downloads, data = network-first. RSC-payload bypass so `_rsc` responses can't answer a navigation | `public/sw.js` |
| **GPS tracking** | Works. watchPosition high-accuracy, start/pause/resume/stop/discard, persists on every accepted fix, crash recovery | `src/hooks/useTracker.ts` |
| **Track math** | Done, tested. Noise gating (50 m accuracy ceiling, 4 m min step, 15 m/s speed reject, 3 m elevation threshold), distance/gain/pace, **off-route detection at 60 m already written** | `src/lib/track.ts`, `track.test.ts` |
| **Geometry storage** | Done, tested. Encoded polyline + RDP simplify. 807 → 31 bytes/row, 10.1 m worst deviation, 0 decode failures on 66k rows | `src/lib/polyline.ts`, `polyline.test.ts` |
| **Peak imagery** | Works. Real Wikipedia lead image when backfilled, Mapbox satellite view of the exact summit otherwise, so every peak has a visual with zero storage | `src/lib/peakImage.ts`, `scripts/backfill-peak-photos.ts` |
| **Map** | Works. Mapbox GL, peaks + decoded trails, difficulty colouring, iconic gold, satellite toggle, bounds-driven loading | `src/components/Map.tsx` |
| **Summit logging** | Partial. Table, types, insert form on the peak page, `/logbook` timeline with four stat tiles. **No map.** | `src/app/logbook/page.tsx` |
| **Lists** | Works. Account-scoped, peaks + routes in one list | `src/lib/lists.ts`, `/lists` |
| **Reviews** | Works. Star ratings + conditions + text | `src/lib/reviews.ts` |
| **SummitMind** | Scaffolded, **uncommitted**, not reachable from any page, needs `QDRANT_URL` / `ANTHROPIC_API_KEY` / Langfuse vars that aren't set. Deliberately left as TODO blocks for you to fill in | `src/lib/summitmind/**`, `docs/summitmind/` |

20 routes exist: `/`, `/explore`, `/peaks`, `/peaks/[id]`, `/routes`, `/routes/[id]`,
`/search`, `/lists`, `/lists/[id]`, `/logbook`, `/profile`, `/record`, `/activities`,
`/activities/[id]`, `/downloads`, `/offline`, auth pages, `/api/summitmind/chat`.

### 0.3 The four gaps between that and what you asked for

**Gap 1 — "download a trail and use the navigation offline like AllTrails."**
You have offline *maps and trail data*. You do not have offline *navigation*. Specifically:

- `/record` fetches the route from Supabase on mount. Offline that promise rejects, so the
  page never leaves its loading state. Navigation is the one screen that must never touch
  the network.
- Downloads are anchored to a **route**, not a mountain. You download "Skyline Trail",
  not "Mount Rainier".
- `track.ts` computes off-route distance (`OFF_ROUTE_M = 60`) but nothing in the UI ever
  tells you. No alert, no haptic, no bearing, no distance-to-summit, no next waypoint.
- Download sizes are impractical on long routes — a bbox around a 313 km trail is ~132 MB
  of tiles, most of it map you will never look at.
- Mapbox GL needs its style JSON, glyphs and sprite sheets cached to render offline at
  all. `sw.js` has an `isMapboxAsset` branch but it has never been verified against a
  cold offline navigation start.
- No images are cached, so an offline peak page has no photo.

**Gap 2 — "a map section for each person for mountains they summited."**
`/logbook` is a list. There is no map anywhere in it, no progress against a defined set,
and the only way to log a summit is to find the peak page and scroll to the bottom.

**Gap 3 — "remove all trails or hikes that are not mountains, leave the top few thousand."**
The architecture points the wrong way. `routes` is the primary surface and was imported
per-country, so most of the 66,331 trails were canal paths, farm tracks and city
footways that never approach a summit. Peaks were the decoration.

**Gap 4 — "click a mountain and see a lot about it, images offline."**
The peak page has a hero, a stats grid, trails, reviews and a Wikipedia blurb. It has no
gallery, no prominence/range/first-ascent, no per-route elevation profile, no weather, no
nearby peaks, no best-season, and nothing is available offline.

### 0.4 Your curated list, measured

I pulled your JSON out of the transcript and saved it to **`data/curated-peaks.json`**
(298 KB) so it is now a versioned input rather than a chat message.

```
1,032 peaks   1,032 unique ids   0 duplicates
fields: id, name, country, continent, region, elevation_m, elevation_ft,
        latitude, longitude, category, difficulty

continent    North America 457 · Europe 397 · Asia 178
category     popular 730 · top_peak 215 · highpoint 87
difficulty   hike 781 · scramble 148 · technical 103
countries    40 — US 457, JP 123, UK 58, CN 55, CH 48, IT 38, AT 30,
                  ES 29, FR 28, DE 28, NO 15, GR 13, … NL 1
```

Validated: 0 invalid coordinates, 0 non-positive elevations, 0 duplicate ids.

**40 countries is the single most important number in this document.** The old importer
did country-scale Overpass queries and we only ever managed four countries — US, CA, CH,
JP — before it filled the disk. Forty is not reachable that way. It forces the design
change in §2.3, and that change is what makes the whole thing both global and small.

Two incidental wins worth noting. First, **all eight peaks you originally wanted in
"Beginner Hikes" are in the list** — Washington, Rainier, Hood, Baker, Shasta, Adams,
St. Helens, Marcy — so that seed becomes eight slugs in a SQL file instead of a
fuzzy-matching script. `sql/canonical-summits.sql` was written for that job and never ran;
it can be deleted. Second, the list already distinguishes the two Mount Adamses and the
two Mount Washingtons by region, which is exactly the disambiguation the old OSM-derived
catalogue could not do.

Coverage gaps, for §6.1: three continents only. No South America, Africa, Oceania or
South Asia, and **no Canada at all**. Of the Seven Summits it has Everest, Denali and
Elbrus; Aconcagua, Kilimanjaro, Vinson, Puncak Jaya and Kosciuszko are missing.

---

## 1. What we're actually building

> A mountain-first app. The unit of everything — browsing, downloading, navigating,
> logging — is a **summit**, not a trail. A trail exists only because it reaches one.

Said plainly, so there are no surprises later: **this stops being an AllTrails clone.**
Searching for a flat lakeside loop will return nothing. That is the request, and I think
it is the right call — it is the only way the app is distinctive, and it is the only way
1,032 mountains with real depth fits in a free-tier database. But it is a real trade-off
and it is worth seeing it written down before we delete anything.

### 1.1 Seven decisions I'm making unless you say otherwise

**D1 — Peaks are the spine.** `peaks` is the primary entity, seeded from your 1,032.
Everything else hangs off a peak. `/explore` and `/search` become peak-first.

**D2 — Slugs are the primary key.** Your JSON already has `mount-rainier-united-states`.
Use that as the PK, not an OSM id. Three wins: the seed is idempotent and re-runnable, URLs
read as `/peaks/mount-rainier-united-states`, and the catalogue stops being coupled to OSM
churn and to the import pipeline that caused the outage. `osm_id` stays as a nullable join
key for geometry only.

**D3 — The offline unit is a mountain.** "Download Mount Rainier" gets you: the peak
record, every route to its summit, a tile corridor around those routes plus a disc around
the summit, the hero and gallery images, and the page HTML + JS. One button, one bundle,
one row in `/downloads`.

**D4 — Tile corridors, not bounding boxes.** Replace `tilesForBBox(padBBox(...))` with
`tilesAlongLines(lines, radiusKm)` for the expensive zooms (z12–14) and keep cheap bbox
coverage at z10–11. A corridor is roughly a tenth of the tiles of a bbox on a long linear
route, which is what turns 132 MB into something you would actually tap.

**D5 — Images: URLs in Postgres, bytes in the Cache API.** Storing bytes in Postgres is
exactly what killed the last database. Hero + 4–6 Wikimedia Commons images per peak,
capped at 1600 px, cached on device at download time. ~6 × 250 KB = ~1.5 MB per peak.

**D6 — Navigation is offline-first, always.** `/record` reads the offline bundle **first**
and the network second, never the reverse. If that inverts, navigation is broken in the
only place it matters.

**D7 — SummitMind stays parked.** It is a genuinely separate product (RAG + weather +
hazard bulletins + risk synthesis) and it is scaffolded for you to fill in by hand. It is
not in this plan. It gets committed to a branch so it stops showing as untracked noise.

---

## 2. Target data model

```sql
peaks
  slug            text primary key        -- "mount-rainier-united-states"
  name            text not null
  country         text not null
  continent       text not null
  region          text
  elevation_m     int not null
  latitude        double precision not null
  longitude       double precision not null
  category        text    -- highpoint | top_peak | popular
  difficulty      text    -- hike | scramble | technical
  -- enriched (§3.2), all nullable so the seed never blocks on them
  prominence_m    int
  range_name      text
  first_ascent    text
  summary         text                    -- 1–2 paragraphs, Wikipedia
  wikipedia_url   text
  wikidata_id     text
  hero_photo_url  text
  best_season     text
  osm_id          bigint                  -- nearest natural=peak node, join only
  route_count     int  default 0          -- denormalised, kept by trigger
  summit_count    int  default 0          -- how many users have bagged it
  search          tsvector generated

peak_photos       slug → url, credit, license, width, sort_order
routes            id, peak_slug, name, poly, distance_km, ascent_m,
                  est_time_min, difficulty, route_type, bbox_*,
                  distance_to_summit_m, is_summit_route
summit_logs       user_id, peak_slug, summited_at, notes, rating,
                  photos[], duration_minutes, track_id, is_public
peak_lists        user_id, name, is_public          (keep, retarget to slug)
list_items        list_id, peak_slug
reviews           user_id, peak_slug, rating, conditions, body
profiles          (unchanged)
```

### 2.1 Why `routes` now belongs to a peak

Today a route is a free-floating OSM object and `route_peaks` is a many-to-many built by
a spatial linking pass. That pass is what produced 84,320 links across 66,331 routes, most
of them incidental — a footpath that happens to pass within range of a hill.

Inverting it (`routes.peak_slug` not null) means a route cannot exist without a mountain.
That single constraint is the pivot, expressed in the schema. A handful of routes legitimately
reach two summits; those get a second row with its own `distance_to_summit_m`, which costs
31 bytes of geometry and removes an entire join table.

### 2.2 Size budget

| | rows | bytes/row | total |
|---|---|---|---|
| peaks (with summary text) | 1,032 | ~2 KB | **2 MB** |
| peak_photos | ~6,000 | ~200 B | **1.2 MB** |
| routes (polyline geometry) | ~12,000 | ~900 B | **11 MB** |
| summit_logs / lists / reviews | low thousands | — | **< 5 MB** |
| indexes | — | — | **~15 MB** |
| **total** | | | **~35 MB of 500 MB** |

Fourteen times under the free-tier limit, with the whole catalogue and room to triple it.
For comparison, the database that went read-only was 1,519 MB in the `routes` table alone —
399,060 rows, of which ~678 MB was TOAST and most of the rest was dead tuples from importing
the same countries three times.

### 2.3 The import flip: 1,032 small queries, not 40 big ones

The old way, per country: one Overpass query for every `highway=path|footway` in the
country, hope it doesn't time out, write ~100k rows, discover 33% is farm roads.

The new way, per peak: one Overpass query in an ~8 km box around a known summit, keep only
geometry that comes within 500 m of it or is a named route tagged to it.

```
1,032 queries × ~2 s politeness delay ≈ 35 minutes, unattended
```

Thirty-five minutes to cover **forty countries**, against the hours that covered four and
broke the database. It is smaller, faster, global, and — because every query is anchored to
a summit you chose — it cannot import a street in South Dakota. The junk filtering stops
being a cleanup pass and becomes structurally impossible.

---

## 3. The phases

Each phase ends in a state you can look at. Nothing here needs the phase after it to be
useful. Times assume I'm doing the work.

### Phase 0 — Unblock · *you, ~15 min*

Create a new Supabase project (free tier is now correct, not a compromise — see §2.2) and
put the new `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. I never see or handle those values.

**Done when:** `curl $URL/rest/v1/` returns 200.

### Phase 1 — Schema and seed · *~4 h*

- `sql/peaks-first-schema.sql` — the model in §2, RLS, grants, indexes, the `route_count`
  trigger, the `search` tsvector.
- `scripts/seed-peaks.ts` — reads `data/curated-peaks.json`, upserts on `slug`. Idempotent:
  running it twice changes nothing. Validates every row before writing (lat/lng in range,
  elevation positive, slug unique, country non-empty) and refuses the whole batch on a bad
  row rather than writing half.
- Retarget `peak_lists` / `list_items` / `summit_logs` / `reviews` from `peak_id` to
  `peak_slug`.

**Acceptance:** 1,032 rows · 0 duplicate slugs · 0 rows failing validation · `/peaks`
renders the list · `pg_database_size` < 10 MB · re-running the seed is a no-op.

### Phase 2 — Enrichment · *~6 h, mostly unattended*

Per peak, cheapest source first. Every field nullable, so a miss degrades instead of failing.

1. **Wikidata** (`wbsearchentities` by name + coordinate match within 5 km) → `wikidata_id`,
   prominence, range, first ascent, Commons category.
2. **Wikipedia REST summary** → `summary`, `wikipedia_url`, lead image.
   `scripts/backfill-peak-photos.ts` already does this — adapt it.
3. **Wikimedia Commons** category listing → 4–6 gallery images at ≤ 1600 px, with credit
   and licence, into `peak_photos`. Licence and attribution are stored because Commons
   requires it and because an unattributed photo is a liability, not a feature.
4. **OSM** nearest `natural=peak` within 500 m → `osm_id`.
   `scripts/tag-iconic.ts` already does nearest-peak matching by location — reuse that; it
   is why kanji-named Japanese peaks matched last time.
5. **Elevation check** against Mapbox Terrain-RGB; flag any disagreement > 100 m for review
   rather than overwriting your curated value.

**Acceptance:** ≥ 90% have a summary · ≥ 80% have ≥ 1 real photo · **100% have a usable
hero** (satellite fallback guarantees this) · 0 coordinate-hemisphere errors · every
elevation within 100 m of terrain data or explicitly flagged · DB < 15 MB.

### Phase 3 — Routes to summits only · *~8 h, mostly unattended*

The §2.3 import. Per peak: Overpass in an 8 km box for `highway=path|footway` plus hiking
relations; keep geometry within 500 m of the summit or named-and-tagged to it; simplify with
RDP; store as `poly`; compute distance, ascent (Terrain-RGB), Naismith time, type
(loop vs out-and-back), `distance_to_summit_m`.

Carry forward the three bugs that cost real time last round, as assertions rather than
memories:

- Overpass returns **HTTP 200 with a `remark`** when it times out. Treat any `remark` as a
  failure. This silently cost us all of the US and Canada on the first ways run.
- `highway=track` is farm and forestry roads. Never import it. It is where all 8,271
  "229th Street" and "Forest Service Road 335" rows came from.
- Reject road-like names (`^\d+(st|nd|rd|th)? (Street|Avenue|Road|…)`, `^(County|Township|
  Forest Service) (Road|Route)`) at write time, not in a later audit.

**Acceptance:** every `difficulty: hike` peak has ≥ 1 route · total routes < 15,000 · DB
< 120 MB · **0 road-like names** (the audit's 9 is the ceiling, not the floor) · 0 undecodable
geometries across the whole table · `/peaks/[slug]` lists routes ordered by directness.

Peaks with no route found — mostly `technical`, where there is no path because you climb
it — show an honest "no mapped trail; this is a climb" state rather than an empty list.

### Phase 4 — The peak page as the centrepiece · *~12 h*

This is the "click on the mountain and see a lot about it" screen, and it is the one users
will judge the app by.

- **Hero gallery** — swipeable, Wikimedia photos with credit, satellite fallback, blurred
  low-res placeholder so it doesn't flash.
- **Stats** — elevation (m and ft), prominence, rank within its country, category badge,
  difficulty, first ascent, range.
- **Terrain map** — Mapbox with `terrain-rgb` exaggeration and a sky layer, pitched. A
  mountain should look like a mountain, not a dot on a flat tile.
- **Routes** — each with distance, gain, Naismith time, difficulty, type, and an
  `ElevationProfile` (the component already exists).
- **Weather** — Open-Meteo, no API key, current + 7-day at summit elevation.
- **Summit log panel** — who has bagged it, your own history, one-tap log.
- **Reviews** — existing component, retargeted to slug.
- **Nearby peaks** — within 50 km, so browsing one mountain leads to the next.
- **Download button** — Phase 5.

**Acceptance:** the Rainier page shows ≥ 5 photos, ≥ 3 routes with profiles, live weather
and ≥ 5 nearby peaks · LCP < 1.5 s on a warm cache · 0 console errors · no horizontal
scroll at 390 px · every image has an `alt`.

### Phase 5 — Download a mountain · *~10 h*

- `lib/tiles.ts` — add `tilesAlongLines(lines, radiusKm, z)`. Corridor at z12–14, bbox at
  z10–11, plus a 2 km disc at z15 around the summit itself (where you actually need
  detail).
- `lib/offline.ts` — `downloadPeak(slug)` bundling peak JSON + routes + photos + tiles +
  `/peaks/[slug]` HTML and its `/_next/` chunks. Keep the existing SW protocol, progress
  reporting, Cache API fallback and reference-counted deletion — all of that already works.
- **Cache Mapbox's style JSON, glyphs and sprites.** Without these the GL map renders blank
  offline no matter how many tiles you hold. This is the step most likely to be the one
  that bites.
- Show a real estimate before download, and a hard cap with an explanation rather than a
  silent truncation.
- `/downloads` — grouped by mountain, real sizes, total, per-item and bulk delete, and the
  storage estimate from the Storage API.

**Acceptance:** a Rainier bundle is **< 40 MB** and completes in < 90 s on wifi · with the
dev server **stopped**, `/peaks/mount-rainier-united-states` renders fully — photos, map
tiles, all routes · a service-worker update does not delete any download (the unversioned
tile cache already guarantees this; the test proves it) · deleting one of two overlapping
downloads leaves the other's tiles intact.

That last pair are regression tests for bugs we already had and fixed. They stay in the
suite.

### Phase 6 — Offline navigation · *~14 h*

The hardest phase and the reason the app is worth carrying up a mountain.

- **Offline-first load.** `/record?peak=<slug>&route=<id>` reads the bundle, then the
  network. Never blocks on Supabase. This is D6 and it is the one line that cannot regress.
- **Off-route alert.** `track.ts` already gives the distance; add the UI. Banner + Vibration
  API at > 60 m, escalating at > 150 m, with "last on-route point" and a bearing back to it.
  No voice in v1 — offline TTS is unreliable across browsers and a navigation feature that
  works on some phones is worse than one that doesn't exist.
- **Summit guidance.** Distance and bearing to the summit, straight-line and along-route,
  remaining ascent, live Naismith ETA, next waypoint, compass heading.
- **Summit detection.** Within 50 m of the summit → "You're on top of Mount Rainier. Log
  it?" One tap writes a `summit_log` locally.
- **Sync on reconnect.** Logs and tracks queue in `trackStore` and flush when back online,
  with conflict handling for a log written twice.
- **Battery.** Screen-wake only while navigating; throttle map redraws; coalesce writes.

**Acceptance:** in airplane mode — open a downloaded peak, start navigation, map renders,
position updates, a simulated off-route track fires the alert, reaching the summit offers
the log, and the log appears in `/logbook` · the log reaches the database on reconnect
without duplicating · a 2 h session costs < 25% battery on a mid-range phone.

### Phase 7 — The personal summit map · *~8 h*

Your Gap 2, and the feature most likely to make the app sticky.

- **One map, three layers** on `/logbook`: all 1,032 peaks as small dots, your summited ones
  as filled gold markers (`ICONIC_HEX` is already the right colour), clustered when zoomed out.
- **Tap to log** from the map itself — the slow path today is having to find the peak page.
- **Progress panel** — *n* of 1,032 · highpoints bagged (/87) · countries (/40) · continents
  (/3) · total vertical · highest summit. Progress against a defined set is what makes a
  logbook a game rather than a diary.
- **Public profile map** at `/u/[username]` for the ones marked public.
- Works offline from cached logs.

**Acceptance:** logging a summit marks it gold within one render · counts match a direct
SQL count · 1,032 markers stay at 60 fps while panning · the map renders offline.

---

## 4. Order, effort, and what you get when

| Phase | Effort | You can see |
|---|---|---|
| 0 Unblock | **yours, 15 min** | a live database |
| 1 Schema + seed | 4 h | 1,032 real mountains at `/peaks` |
| 2 Enrichment | 6 h | photos and prose on every one |
| 3 Routes | 8 h | trails, and only trails that summit something |
| 4 Peak page | 12 h | the screen that sells the app |
| 5 Download | 10 h | a mountain on your phone |
| 6 Navigation | 14 h | the app works with no signal |
| 7 Summit map | 8 h | your own map filling in |

**~62 hours of my work after your 15 minutes.** Phases 1–4 (30 h) are a complete, coherent
app on their own — it just isn't offline yet. If you want something to look at sooner, stop
after 4 and judge it before committing to 5–7.

I'd run 1→2→3 back to back since 2 and 3 are mostly unattended network time, then 4, then
decide.

---

## 5. Risks, honestly

| Risk | Likelihood | What I do about it |
|---|---|---|
| **Mapbox GL won't render offline** — style/glyph/sprite caching is fiddly and partly undocumented | Medium | Prove it in a 1 h spike at the **start** of Phase 5, before building the bundler around it. Fallback: a raster tile source, which is simpler and definitely cacheable, at some visual cost |
| Overpass rate-limits or drops ~1,032 sequential queries | Medium | Already have exponential backoff to 60 s, a 6-failure ceiling and `--after <slug>` resume from the link-peaks fix. Reuse all three. Worst case the run takes 2 h instead of 35 min |
| Wikimedia photo coverage is thin on obscure peaks | High for the long tail | Accepted. Satellite fallback means 100% visual coverage regardless; acceptance targets 80% real photos, not 100% |
| iOS Safari caps Cache API storage and evicts under pressure | Medium | Read the quota via the Storage API, show it, warn before a download would exceed it, request persistent storage. Document the cap rather than pretending it isn't there |
| Background geolocation stops when the screen locks on iOS | **High — this is a real platform limit** | Wake-lock while navigating and say plainly in the UI that the screen must stay on. A PWA cannot fix this; only a native app can. You should know that before Phase 6, not during it |
| 62 h estimate slips | Medium | Phases are independently shippable. Slipping 6 doesn't block 7 |

Two of those — Mapbox offline rendering and iOS background GPS — are the ones that could
change what Phase 6 can promise. I'd rather flag them now than discover them at hour 50.

---

## 6. Decisions I'd like from you (not blocking — I have defaults)

1. **More peaks than 1,032?** Default: ship 1,032, then add the obvious global misses —
   Kilimanjaro, Aconcagua, Fuji's neighbours, the rest of the Seven Summits, Patagonia, the
   Himalaya beyond the six Tibetan peaks already in there. Your list is strong on
   US/Europe/Japan and has almost nothing in South America, Africa, Oceania or South Asia.
   Call it ~1,200 for genuine global coverage. Still ~3 MB.
2. **Keep `/routes` as a browsable surface?** Default: yes, but filtered to summit routes
   only, reachable from a peak. The alternative is deleting the page entirely and I think
   that loses a useful view.
3. **Canada.** Your list has **zero** Canadian peaks, though the old DB had 2,991 Canadian
   trails. Default: add ~40 Canadian summits (Robson, Assiniboine, Temple, Garibaldi, the
   Banff classics) since you were importing Canada before. Say if that was deliberate.
4. **SummitMind.** Default: commit to a `summitmind` branch, out of this plan. It is
   scaffolded with TODOs for you to fill in by hand, which is how you asked for learning
   work to be left.

---

## 7. What gets deleted

Honest list, so nothing disappears quietly:

- `scripts/import-peaks.ts` — the 134k-peak country importer. Obsolete; the seed replaces it.
- `scripts/import-trail-ways.ts`, `scripts/import-routes.ts` — country-scale trail imports.
  Replaced by the per-peak importer. **Keep the Overpass client, the `remark` detection, the
  adaptive batch sizing and the super-relation resolver** — those were hard-won.
- `scripts/purge-ways.ts`, `scripts/link-peaks.ts` — both exist to clean up after the old
  import. Nothing to clean up now.
- `sql/rebuild-routes.sql`, `lean-schema.sql`, `fresh-schema.sql`, `reclaim-space.sql` —
  superseded by `peaks-first-schema.sql`. Worth keeping `reclaim-space.sql` in `sql/archive/`
  purely as the record of how the disk incident was diagnosed.
- The 66,331 trails and 134,531 peaks — already gone with the project.

`RECOVERY.md` and `RUNBOOK.md` stay. The `.loop/` acceptance harness stays and gets
retargeted at these phases' criteria.

---

# Execution log — 2026-11-18

What actually happened, measured, including where the plan above was wrong.

## Done

**Phase 1 — schema.** `sql/peaks-first-schema.sql`. Peaks keyed by slug, routes with a
non-null `peak_slug`, RLS, 14 indexes, a `route_count` trigger, a `peak_ratings` view.
Not yet applied — needs the database.

**Phase 2 — enrichment.** 1,032 peaks enriched from Wikipedia/Wikidata/Commons into
`data/catalogue/`. **935 matched (90.6%)**, 927 summaries (89.8%), 4,548 photos across 810
peaks (78.5%), every photo carrying its licence and author. The remaining 97 are genuine
gaps — obscure US summits with no English article, or disambiguation pages with no
coordinate-matching entry.

**Phase 5 (partial) — corridor tiling.** `tilesAlongLines` + `planMountainTiles` in
`src/lib/tiles.ts`, 25 tests. `downloadPeak()` in `src/lib/offline.ts` bundles peak,
routes, tiles, photos and page.

**Phase 4 / 7 — UI.** Peak page rebuilt (gallery with attribution, stats, routes, summit
weather, log-a-summit, nearby peaks, download). `/logbook` rebuilt as a map of all 1,032
with summited ones in gold, plus progress against highpoints, countries and vertical.
Whole app migrated from numeric peak ids to slugs — 14 files.

Verified: **0 type errors, 0 lint errors, 76 tests passing, production build green.**

## Running

**Phase 3 — routes.** In progress, resumable, ~95 min remaining at the time of writing.

## Four things the plan got wrong

**1. The corridor's benefit is conditional, not universal.** §1.1 D4 claimed "roughly a
tenth". Measured:

| shape | bbox | corridor | saved |
|---|---|---|---|
| straight 100 km | 8.5 MB | 11.3 MB | **−32%** |
| diagonal 100 km | 65.9 MB | 10.2 MB | 84% |
| meandering 313 km | 671 MB | 47.8 MB | 93% |
| 25 km summit loop | 8.2 MB | 7.1 MB | 14% |

A corridor *loses* on a short straight route, where the bounding box is already a thin
strip. `planMountainTiles` now computes both and keeps the smaller, so it can never do
worse. A Rainier-sized download is **6.2 MB**, against the 40 MB the plan budgeted.

**2. One Overpass query per peak does not work.** §2.3 costed 1,032 queries at ~2 s each,
"about 35 minutes". Measured against the live public instances: all three endpoints timed
out at 75 s, and the one success took **49.7 s to return 33 elements**. They are
saturated, and no amount of politeness fixes that.

The fix was to stop making 1,032 requests. Overpass accepts a union of bounding boxes, so
peaks are batched 12 to a query — 86 queries instead of 1,032 — and each returned way is
assigned to whichever peak in the batch it passes closest to. That assignment is also
*more* correct than per-peak queries, which gave a path between two summits to both.
Measured: 24 peaks, 120 routes, 0 failures, 8 minutes. Full run ≈ 100 minutes.

**3. OSM ways are fragments, not trails.** Not anticipated at all. Half Dome's query
returned "Half Dome Trail" twice, "Snake Dike Approach" three times — 12 rows for 4 real
routes, each showing a fragment's length instead of the trail's. Segments sharing a name
are now stitched end-to-end: Half Dome's 12 became **4**, with the Half Dome Trail merged
from 0.49 km + 2.37 km into one 2.86 km trail, and the John Muir Trail correctly dropped
at 1.7 km from the summit.

**4. The app is light-theme only.** Every status colour written for the new components
assumed a dark palette (`text-amber-300` on `bg-amber-900/15`) and rendered as pale-on-pale.
Caught by screenshot, not by typecheck or lint. All fixed to dark-on-tint.

## Bugs found and fixed along the way

- **Geosearch picks the wrong article.** The nearest Wikipedia page to Rainier's summit is
  "Cascade Range" at 4 m; the mountain is 123 m away. Unchecked, every peak would have
  inherited its *range's* description and photo. Fixed with name scoring, a Wikidata type
  gate, and a 25 km coordinate gate.
- **Wikidata quantities carry units.** Reading `amount` alone gave Mount Adams a
  prominence of 8,116 — feet. Camelback 1,334 ft, Half Dome 1,360 ft. Now unit-aware:
  2,474 m, 407 m, 415 m.
- **MediaWiki returns HTTP 200 with an error body** when `gsradius` exceeds 10 km — the
  same silent-failure shape as Overpass's `remark` that once cost a whole country's
  import. Every geosearch was failing into a worse fallback. Now detected and thrown.
- **Transient failures were recorded as permanent.** `summary()` caught everything and
  returned null, so a rate-limit became "Mount Shasta: no article". Separating 404 from
  5xx/429 and adding a slow retry pass took the match rate from 83% to 90.6%.
- **Supabase rejects rather than resolving when the host is gone**, so a bare `.then`
  left `/logbook` spinning forever — the same bug that shipped on the trail page once
  before. All Supabase calls in effects now use try/catch/finally.
- **An unreachable database looked like an empty one.** The logbook read only `data` and
  cheerfully reported "0 of 0 summits". It now says "Catalogue unavailable" and reassures
  the user their logs are safe.
- **Cache-name drift.** `offline.ts` wrote pages to `am-shell-v3` while the worker kept
  `am-shell-v4`, so every downloaded page would be deleted on the next activate.
  `offline.sync.test.ts` now fails the build if the two ever diverge again.
- **SummitMind broke the production build.** Its config called `required()` at module
  scope, so importing it aborted `next build` with "Missing required env var: QDRANT_URL".
  Now lazy via getters — a module should not throw while being imported.

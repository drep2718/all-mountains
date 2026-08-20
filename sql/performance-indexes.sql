-- ============================================================================
-- PERFORMANCE INDEXES — run ONCE in the Supabase SQL editor.
--
-- WHY THIS IS URGENT
-- The trail import took `routes` from ~2,500 rows to 90,000+. The browse and
-- search queries sort and filter on columns that have no index, so Postgres
-- full-scans and sorts the whole table on every request. Measured against the
-- live DB after the import:
--
--   order by distance_km desc  limit 24   → TIMEOUT (HTTP 500)
--   order by est_time_min desc limit 24   → TIMEOUT (HTTP 500)
--   name ilike '%Ridge%'       limit 24   → 2.5 s
--   peaks: is_iconic, prominence desc     → 2.2 s
--
-- With these indexes each of those becomes an index scan of a few rows.
--
-- CONCURRENTLY keeps the table readable while each index builds, so the app
-- stays up. It cannot run inside a transaction block — if your SQL editor wraps
-- statements in one, run them one at a time, or drop the CONCURRENTLY keyword
-- (that briefly locks writes on the table).
-- ============================================================================

-- --- routes: sorting -------------------------------------------------------
-- "Longest" sort, and the distance filters in the filter sheet.
create index concurrently if not exists routes_distance_idx
  on public.routes (distance_km desc nulls last);

-- "Most time" sort.
create index concurrently if not exists routes_est_time_idx
  on public.routes (est_time_min desc nulls last);

-- Ascent filters / "most climbing" style ordering.
create index concurrently if not exists routes_ascent_idx
  on public.routes (ascent_m desc nulls last);

-- --- routes: filtering -----------------------------------------------------
create index concurrently if not exists routes_country_idx
  on public.routes (country);

create index concurrently if not exists routes_difficulty_idx
  on public.routes (difficulty);

-- Partial index: every browse query asks for named trails only, and this keeps
-- the "is the name null" check off the main table.
create index concurrently if not exists routes_named_idx
  on public.routes (id) where name is not null;

-- --- routes: name search ---------------------------------------------------
-- Trigram index so `name ilike '%foo%'` stops being a full scan. `peaks`
-- already has the equivalent (peaks_name_idx); routes never got one.
create extension if not exists pg_trgm;
create index concurrently if not exists routes_name_trgm_idx
  on public.routes using gin (name public.gin_trgm_ops);

-- --- peaks: popularity ordering -------------------------------------------
-- "Most popular" orders by is_iconic, then prominence, then elevation.
create index concurrently if not exists peaks_prominence_idx
  on public.peaks (prominence desc nulls last);

create index concurrently if not exists peaks_popular_idx
  on public.peaks (is_iconic desc nulls last, prominence desc nulls last);

-- --- route_peaks: the peak↔trail join -------------------------------------
-- The primary key covers (route_id, peak_id); this covers lookups the other
-- way round ("which trails reach this summit").
create index concurrently if not exists route_peaks_peak_idx
  on public.route_peaks (peak_id);

-- --- refresh planner statistics -------------------------------------------
analyze public.routes;
analyze public.peaks;
analyze public.route_peaks;

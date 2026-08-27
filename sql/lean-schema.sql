-- ============================================================================
-- LEAN SCHEMA — shrink `routes` so the catalogue fits a 500 MB database.
--
-- Run in the Supabase SQL editor once Postgres accepts connections.
-- Run each section in order; section 1 is destructive by design.
--
-- WHY
-- Measured over real OSM trails, at ~139k rows:
--     geometry  (GeoJSON jsonb)        ~90 MB
--     path      (PostGIS, derived)     ~73 MB
--     tags      (jsonb)                ~22 MB
--                                     -------
--                                     ~185 MB live data
-- plus a GiST index on `path`, plus dead tuples from importing the US three
-- times and CA/CH/JP twice (~17,200 batch writes, each upsert of an existing
-- row leaving a dead tuple behind). The bloat outweighed the data.
--
-- The same geometry as a simplified encoded polyline measures ~4 MB.
-- ============================================================================


-- --- 0. Measure first -------------------------------------------------------
-- Run alone. If `routes` is not the largest table, stop and reassess rather
-- than deleting anything.
select relname as table_name,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_relation_size(c.oid))       as heap,
       pg_size_pretty(pg_indexes_size(c.oid))        as indexes,
       n_live_tup as live_rows, n_dead_tup as dead_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;

select pg_size_pretty(pg_database_size(current_database())) as database_total;


-- --- 1. Rebuild `routes` ----------------------------------------------------
-- TRUNCATE rather than DELETE: it reclaims the file immediately without needing
-- a VACUUM FULL, and on a disk-pressured instance that difference matters.
-- Every row here is re-importable from OpenStreetMap, so nothing is lost.
-- CASCADE also clears route_peaks, which references it.
truncate table public.routes cascade;

-- Drop the two heavyweight columns and the index that fed on them.
drop index if exists public.routes_path_idx;
alter table public.routes drop column if exists path;
alter table public.routes drop column if exists geometry;
alter table public.routes drop column if exists tags;

-- Geometry as one encoded polyline; ';' separates the segments of a
-- multi-part trail. Decoded in the browser in microseconds.
alter table public.routes add column if not exists poly text;

-- The handful of tag fields the UI actually reads, promoted to real columns
-- so the whole jsonb blob no longer needs storing.
alter table public.routes add column if not exists operator     text;
alter table public.routes add column if not exists ref          text;
alter table public.routes add column if not exists surface      text;
alter table public.routes add column if not exists dog_access   text;
alter table public.routes add column if not exists bicycle      text;
alter table public.routes add column if not exists wheelchair   text;
alter table public.routes add column if not exists fee          text;

-- Any leftover dead space from the old shape.
vacuum full public.routes;


-- --- 2. Replace the PostGIS bounds lookup -----------------------------------
-- routes_in_bounds used the dropped `path` geography. The bbox_* columns carry
-- the same information for a viewport query and are already indexed by
-- routes_bbox_idx, so this is a plain overlap test — and cheaper.
drop function if exists public.routes_in_bounds(double precision, double precision, double precision, double precision, integer);

create or replace function public.routes_in_bounds(
  min_lat double precision,
  min_lng double precision,
  max_lat double precision,
  max_lng double precision,
  lim integer default 100
) returns setof public.routes
language sql stable as $$
  select *
  from public.routes
  where name is not null
    and bbox_min_lat <= max_lat and bbox_max_lat >= min_lat
    and bbox_min_lng <= max_lng and bbox_max_lng >= min_lng
  order by distance_km desc nulls last
  limit lim;
$$;

grant execute on function public.routes_in_bounds(double precision, double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;

-- link_route_peaks also depended on `path`. Linking is done by
-- scripts/link-peaks.ts against the bbox columns instead.
drop function if exists public.link_route_peaks(integer);


-- --- 3. Indexes the browse queries need -------------------------------------
-- Without these the sorts full-scan the table; "Longest" and "Most time" both
-- timed out at 139k rows before.
create index if not exists routes_distance_idx  on public.routes (distance_km desc nulls last);
create index if not exists routes_est_time_idx  on public.routes (est_time_min desc nulls last);
create index if not exists routes_country_idx   on public.routes (country);
create index if not exists routes_network_idx   on public.routes (network);
create index if not exists routes_named_idx     on public.routes (id) where name is not null;

create extension if not exists pg_trgm;
create index if not exists routes_name_trgm_idx on public.routes using gin (name public.gin_trgm_ops);

create index if not exists peaks_prominence_idx on public.peaks (prominence desc nulls last);
create index if not exists peaks_popular_idx    on public.peaks (is_iconic desc nulls last, prominence desc nulls last);
create index if not exists route_peaks_peak_idx on public.route_peaks (peak_id);

analyze public.routes;
analyze public.peaks;


-- --- 4. Confirm the result --------------------------------------------------
select pg_size_pretty(pg_database_size(current_database())) as database_after;

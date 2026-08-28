-- ============================================================================
-- REBUILD `routes` IN ITS LEAN SHAPE
--
-- Run this whole file in the Supabase SQL editor, in one go. Safe to paste
-- entirely: `routes` has already been truncated, so the drop below discards
-- nothing. Peaks are never touched.
--
-- Why a drop rather than ALTER: TRUNCATE emptied the table but left the old
-- shape — geometry, path and tags still there, poly and the promoted tag
-- columns absent. The importer writes the new shape, so every batch was
-- rejected with "Could not find the 'bicycle' column". Recreating is simpler
-- and cheaper than eight ALTERs on an empty table.
-- ============================================================================

drop table if exists public.route_peaks;
drop table if exists public.routes cascade;

create table public.routes (
  id            bigint generated always as identity primary key,
  osm_id        bigint not null unique,  -- negative for ways, positive for relations
  name          text,
  network       text,                    -- iwn | nwn | rwn | lwn
  distance_km   real,
  difficulty    text,
  ascent_m      real,
  descent_m     real,
  route_type    text,                    -- Loop | Out & Back
  est_time_min  integer,
  features      text[],

  -- Trail geometry as a Google-encoded polyline; ';' separates the segments of
  -- a multi-part trail. Replaces GeoJSON jsonb plus a derived PostGIS
  -- geography: 31 bytes per row against 807, measured on real trails.
  poly          text,

  bbox_min_lat  double precision,
  bbox_min_lng  double precision,
  bbox_max_lat  double precision,
  bbox_max_lng  double precision,

  country       text,
  region        text,
  description   text,

  -- The only OSM tags the UI reads; the rest of the blob is not stored.
  operator      text,
  ref           text,
  surface       text,
  dog_access    text,
  bicycle       text,
  wheelchair    text,
  fee           text,

  created_at    timestamptz default now()
);

create table public.route_peaks (
  route_id bigint not null references public.routes(id) on delete cascade,
  peak_id  bigint not null references public.peaks(id)  on delete cascade,
  primary key (route_id, peak_id)
);

-- --- Indexes ----------------------------------------------------------------
-- Their absence is what made "Longest" and "Most time" time out at 139k rows.
create extension if not exists pg_trgm;

create index routes_bbox_idx       on public.routes (bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng);
create index routes_distance_idx   on public.routes (distance_km desc nulls last);
create index routes_est_time_idx   on public.routes (est_time_min desc nulls last);
create index routes_ascent_idx     on public.routes (ascent_m desc nulls last);
create index routes_country_idx    on public.routes (country);
create index routes_network_idx    on public.routes (network);
create index routes_difficulty_idx on public.routes (difficulty);
create index routes_named_idx      on public.routes (id) where name is not null;
create index routes_features_idx   on public.routes using gin (features);
create index routes_name_trgm_idx  on public.routes using gin (name gin_trgm_ops);
create index route_peaks_peak_idx  on public.route_peaks (peak_id);

-- Peaks kept their rows, but never had these.
create index if not exists peaks_prominence_idx on public.peaks (prominence desc nulls last);
create index if not exists peaks_popular_idx    on public.peaks (is_iconic desc nulls last, prominence desc nulls last);

-- --- Viewport lookup --------------------------------------------------------
-- The old version used the dropped PostGIS `path`. The bbox columns hold the
-- same information for a viewport query and are indexed above.
drop function if exists public.routes_in_bounds(double precision, double precision, double precision, double precision, integer);

create function public.routes_in_bounds(
  min_lat double precision, min_lng double precision,
  max_lat double precision, max_lng double precision,
  lim integer default 100
) returns setof public.routes
language sql stable as $$
  select * from public.routes
  where name is not null
    and bbox_min_lat <= max_lat and bbox_max_lat >= min_lat
    and bbox_min_lng <= max_lng and bbox_max_lng >= min_lng
  order by distance_km desc nulls last
  limit lim;
$$;

-- Linking is done by scripts/link-peaks.ts in chunks; the old single-statement
-- version outgrew the statement timeout.
drop function if exists public.link_route_peaks(integer);

-- --- Access -----------------------------------------------------------------
-- Catalogue data is public to read and only ever written by the importer,
-- which uses the service role and bypasses RLS.
alter table public.routes      enable row level security;
alter table public.route_peaks enable row level security;

drop policy if exists routes_public      on public.routes;
drop policy if exists route_peaks_public on public.route_peaks;
create policy routes_public      on public.routes      for select using (true);
create policy route_peaks_public on public.route_peaks for select using (true);

grant select on public.routes, public.route_peaks to anon, authenticated;
grant all    on public.routes, public.route_peaks to service_role;
grant execute on function public.routes_in_bounds(double precision, double precision, double precision, double precision, integer)
  to anon, authenticated, service_role;

analyze public.routes;
analyze public.peaks;

select 'routes rebuilt' as status,
       pg_size_pretty(pg_database_size(current_database())) as db_size;

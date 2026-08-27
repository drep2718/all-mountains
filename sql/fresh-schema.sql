-- ============================================================================
-- ALL MOUNTAINS — complete schema for a FRESH Supabase project.
--
-- Paste this whole file into the SQL editor of a brand-new project and run it
-- once. It is the entire database: tables, policies, functions, indexes.
--
-- Differences from the schema that filled a 500 MB disk:
--
--   * No PostGIS. `peaks_in_bounds` always used plain lat/lng, and the only
--     things that needed the geography columns were a one-off tagging script
--     and a linking function now done in application code. Dropping it removes
--     the `peaks.location` column, the `routes.path` column, and two GiST
--     indexes.
--   * Trail geometry is one encoded-polyline text column instead of GeoJSON
--     jsonb plus a derived geography. Measured on real trails: 31 bytes per
--     row against 807, ~4 MB across the catalogue against ~185 MB.
--   * The six OSM tag fields the UI reads are real columns; the rest of the
--     tag blob is not stored.
--   * Every index the browse and search queries need is here from the start.
--     Their absence is what made "Longest" and "Most time" time out.
-- ============================================================================

-- Supabase installs extensions into the `extensions` schema, so the operator
-- class below is referenced unqualified and resolved through search_path.
-- Hard-coding public.gin_trgm_ops fails on a fresh project.
create extension if not exists pg_trgm;

-- ============================================================================
-- PEAKS
-- ============================================================================
create table if not exists public.peaks (
  id            bigint generated always as identity primary key,
  osm_id        bigint not null unique,
  name          text,
  name_en       text,
  elevation     real,
  prominence    real,
  latitude      double precision not null,
  longitude     double precision not null,
  country       text,
  region        text,
  wikipedia_url text,
  photo_url     text,
  difficulty    text,
  description   text,
  is_iconic     boolean default false,
  created_at    timestamptz default now()
);

create index if not exists peaks_elevation_idx  on public.peaks (elevation desc);
create index if not exists peaks_lat_lng_idx    on public.peaks (latitude, longitude);
create index if not exists peaks_iconic_idx     on public.peaks (is_iconic) where is_iconic;
create index if not exists peaks_prominence_idx on public.peaks (prominence desc nulls last);
create index if not exists peaks_popular_idx    on public.peaks (is_iconic desc nulls last, prominence desc nulls last);
create index if not exists peaks_name_trgm_idx  on public.peaks using gin (name gin_trgm_ops);
create index if not exists peaks_country_idx    on public.peaks (country);

-- ============================================================================
-- ROUTES (trails)
-- ============================================================================
create table if not exists public.routes (
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

  -- Trail geometry as a Google-encoded polyline, ';' between the segments of a
  -- multi-part trail. Decoded in the browser by lib/polyline.
  poly          text,

  bbox_min_lat  double precision,
  bbox_min_lng  double precision,
  bbox_max_lat  double precision,
  bbox_max_lng  double precision,

  country       text,
  region        text,
  description   text,

  -- The only OSM tags the UI reads.
  operator      text,
  ref           text,
  surface       text,
  dog_access    text,
  bicycle       text,
  wheelchair    text,
  fee           text,

  created_at    timestamptz default now()
);

create index if not exists routes_bbox_idx      on public.routes (bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng);
create index if not exists routes_distance_idx  on public.routes (distance_km desc nulls last);
create index if not exists routes_est_time_idx  on public.routes (est_time_min desc nulls last);
create index if not exists routes_ascent_idx    on public.routes (ascent_m desc nulls last);
create index if not exists routes_country_idx   on public.routes (country);
create index if not exists routes_network_idx   on public.routes (network);
create index if not exists routes_difficulty_idx on public.routes (difficulty);
create index if not exists routes_named_idx     on public.routes (id) where name is not null;
create index if not exists routes_features_idx  on public.routes using gin (features);
create index if not exists routes_name_trgm_idx on public.routes using gin (name gin_trgm_ops);

-- ============================================================================
-- ROUTE ↔ PEAK JUNCTION
-- ============================================================================
create table if not exists public.route_peaks (
  route_id bigint not null references public.routes(id) on delete cascade,
  peak_id  bigint not null references public.peaks(id)  on delete cascade,
  primary key (route_id, peak_id)
);
create index if not exists route_peaks_peak_idx on public.route_peaks (peak_id);

-- ============================================================================
-- USER TABLES
-- ============================================================================
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  username         text unique,
  display_name     text,
  avatar_url       text,
  bio              text,
  home_latitude    double precision,
  home_longitude   double precision,
  search_radius_km integer default 100,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create table if not exists public.peak_lists (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  is_public   boolean default false,
  created_at  timestamptz default now()
);

create table if not exists public.list_items (
  id         bigint generated always as identity primary key,
  list_id    bigint not null references public.peak_lists(id) on delete cascade,
  peak_id    bigint references public.peaks(id)  on delete cascade,
  route_id   bigint references public.routes(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint one_item_kind check (num_nonnulls(peak_id, route_id) = 1)
);
create unique index if not exists list_items_list_peak_uniq  on public.list_items (list_id, peak_id)  where peak_id  is not null;
create unique index if not exists list_items_list_route_uniq on public.list_items (list_id, route_id) where route_id is not null;
create index        if not exists list_items_list_idx        on public.list_items (list_id);

create table if not exists public.summit_logs (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  peak_id          bigint not null references public.peaks(id) on delete cascade,
  summited_at      date not null,
  duration_minutes integer,
  distance_km      real,
  elevation_gain_m real,
  weather          text,
  conditions       text,
  notes            text,
  rating           integer check (rating between 1 and 5),
  photos           text[],
  is_public        boolean default true,
  created_at       timestamptz default now()
);
create index if not exists summit_logs_user_idx on public.summit_logs (user_id);

-- Reviews & ratings.
create table if not exists public.reviews (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  route_id   bigint references public.routes(id) on delete cascade,
  peak_id    bigint references public.peaks(id)  on delete cascade,
  rating     int not null check (rating between 1 and 5),
  body       text,
  conditions text[],
  hiked_on   date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint one_subject check (num_nonnulls(route_id, peak_id) = 1)
);
create unique index if not exists reviews_user_route_uniq on public.reviews (user_id, route_id) where route_id is not null;
create unique index if not exists reviews_user_peak_uniq  on public.reviews (user_id, peak_id)  where peak_id  is not null;
create index        if not exists reviews_route_idx       on public.reviews (route_id) where route_id is not null;
create index        if not exists reviews_peak_idx        on public.reviews (peak_id)  where peak_id  is not null;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Peaks inside a viewport. Plain lat/lng — no PostGIS needed.
create or replace function public.peaks_in_bounds(
  min_lat double precision, min_lng double precision,
  max_lat double precision, max_lng double precision,
  min_elevation real default 0, lim integer default 300
) returns setof public.peaks
language sql stable as $$
  select * from public.peaks
  where latitude between min_lat and max_lat
    and longitude between min_lng and max_lng
    and (elevation >= min_elevation or elevation is null)
  order by elevation desc nulls last
  limit lim;
$$;

-- Trails whose bounding box overlaps a viewport.
create or replace function public.routes_in_bounds(
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

-- Nearest peaks to a point. Equirectangular approximation, which is accurate
-- well past any radius this is called with and needs no geography type.
create or replace function public.nearby_peaks(
  lat double precision, lng double precision,
  radius_km integer default 100, lim integer default 50
) returns setof public.peaks
language sql stable as $$
  select * from public.peaks
  where latitude  between lat - (radius_km / 110.574)
                      and lat + (radius_km / 110.574)
    and longitude between lng - (radius_km / (111.320 * cos(radians(lat))))
                      and lng + (radius_km / (111.320 * cos(radians(lat))))
  order by
    ((latitude - lat) * 110.574) ^ 2 +
    ((longitude - lng) * 111.320 * cos(radians(lat))) ^ 2
  limit lim;
$$;

-- A profile row for every new signup.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_review() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists reviews_touch on public.reviews;
create trigger reviews_touch before update on public.reviews
  for each row execute function public.touch_review();

-- ============================================================================
-- AGGREGATE RATINGS
-- ============================================================================
create or replace view public.route_ratings as
  select route_id, round(avg(rating)::numeric, 2) as avg_rating, count(*) as review_count
  from public.reviews where route_id is not null group by route_id;

create or replace view public.peak_ratings as
  select peak_id, round(avg(rating)::numeric, 2) as avg_rating, count(*) as review_count
  from public.reviews where peak_id is not null group by peak_id;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Catalogue data is public to read and never written by the client; the
-- importer uses the service role, which bypasses RLS.
alter table public.peaks       enable row level security;
alter table public.routes      enable row level security;
alter table public.route_peaks enable row level security;

drop policy if exists peaks_public       on public.peaks;
drop policy if exists routes_public      on public.routes;
drop policy if exists route_peaks_public on public.route_peaks;
create policy peaks_public       on public.peaks       for select using (true);
create policy routes_public      on public.routes      for select using (true);
create policy route_peaks_public on public.route_peaks for select using (true);

-- Profiles: readable by all, writable by the owner.
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_upsert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select using (true);
create policy profiles_upsert on public.profiles for insert with check (id = auth.uid());
create policy profiles_update on public.profiles for update using (id = auth.uid());

-- Lists: owner writes; owner or anyone reads a public list.
alter table public.peak_lists enable row level security;
drop policy if exists peak_lists_select on public.peak_lists;
drop policy if exists peak_lists_insert on public.peak_lists;
drop policy if exists peak_lists_update on public.peak_lists;
drop policy if exists peak_lists_delete on public.peak_lists;
create policy peak_lists_select on public.peak_lists for select using (user_id = auth.uid() or is_public);
create policy peak_lists_insert on public.peak_lists for insert with check (user_id = auth.uid());
create policy peak_lists_update on public.peak_lists for update using (user_id = auth.uid());
create policy peak_lists_delete on public.peak_lists for delete using (user_id = auth.uid());

alter table public.list_items enable row level security;
drop policy if exists list_items_select on public.list_items;
drop policy if exists list_items_insert on public.list_items;
drop policy if exists list_items_delete on public.list_items;
create policy list_items_select on public.list_items for select using (
  exists (select 1 from public.peak_lists l where l.id = list_id and (l.user_id = auth.uid() or l.is_public))
);
create policy list_items_insert on public.list_items for insert with check (
  exists (select 1 from public.peak_lists l where l.id = list_id and l.user_id = auth.uid())
);
create policy list_items_delete on public.list_items for delete using (
  exists (select 1 from public.peak_lists l where l.id = list_id and l.user_id = auth.uid())
);

alter table public.summit_logs enable row level security;
drop policy if exists summit_logs_select on public.summit_logs;
drop policy if exists summit_logs_write  on public.summit_logs;
drop policy if exists summit_logs_update on public.summit_logs;
drop policy if exists summit_logs_delete on public.summit_logs;
create policy summit_logs_select on public.summit_logs for select using (user_id = auth.uid() or is_public);
create policy summit_logs_write  on public.summit_logs for insert with check (user_id = auth.uid());
create policy summit_logs_update on public.summit_logs for update using (user_id = auth.uid());
create policy summit_logs_delete on public.summit_logs for delete using (user_id = auth.uid());

alter table public.reviews enable row level security;
drop policy if exists reviews_select on public.reviews;
drop policy if exists reviews_insert on public.reviews;
drop policy if exists reviews_update on public.reviews;
drop policy if exists reviews_delete on public.reviews;
create policy reviews_select on public.reviews for select using (true);
create policy reviews_insert on public.reviews for insert with check (user_id = auth.uid());
create policy reviews_update on public.reviews for update using (user_id = auth.uid());
create policy reviews_delete on public.reviews for delete using (user_id = auth.uid());

-- ============================================================================
-- GRANTS
-- ============================================================================
grant usage on schema public to anon, authenticated, service_role;
grant select on public.peaks, public.routes, public.route_peaks to anon, authenticated;
grant select on public.route_ratings, public.peak_ratings to anon, authenticated;
grant all on public.profiles, public.peak_lists, public.list_items,
             public.summit_logs, public.reviews to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role, authenticated;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- ============================================================================
select 'schema ready' as status,
       pg_size_pretty(pg_database_size(current_database())) as size;

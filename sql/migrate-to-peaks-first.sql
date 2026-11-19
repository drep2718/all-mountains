-- ============================================================================
-- Migrate to the peaks-first model.
--
-- Run this ONCE, whole file, in the Supabase SQL editor.
--
-- WHAT THIS DESTROYS (deliberately — this is the pivot):
--     peaks         134,531 OSM summit nodes  → replaced by 1,032 curated peaks
--     routes         66,331 trails            → replaced by summit routes only
--     route_peaks    84,320 link rows         → gone; a route now belongs to a peak
--     summit_logs         0 rows              → nothing to lose
--     peak_lists/items  1 list, 0 items       → one empty list
--
-- WHAT SURVIVES:
--     profiles  — your account, keyed to auth.users. Never dropped.
--     auth.*    — untouched.
--
-- DROP, not DELETE. DROP unlinks the files and reclaims the disk immediately;
-- DELETE writes a dead tuple per row and needs WAL space to do it, which is
-- precisely how this database filled up and went read-only before.
-- ============================================================================

begin;

-- Old catalogue. CASCADE clears the foreign keys and the PostGIS-backed
-- functions that referenced them.
drop table if exists route_peaks cascade;
drop table if exists list_items  cascade;
drop table if exists summit_logs cascade;
drop table if exists peak_lists  cascade;
drop table if exists reviews     cascade;
drop table if exists routes      cascade;
drop table if exists peaks       cascade;

-- Functions and views built on the old shape.
drop function if exists peaks_in_bounds(double precision, double precision, double precision, double precision, int, int) cascade;
drop function if exists peaks_in_bounds(double precision, double precision, double precision, double precision, int) cascade;
drop function if exists routes_in_bounds(double precision, double precision, double precision, double precision, int) cascade;
drop function if exists link_route_peaks() cascade;
drop view     if exists peak_ratings  cascade;
drop view     if exists route_ratings cascade;

commit;

-- ============================================================================
-- The new schema follows, verbatim from sql/peaks-first-schema.sql.
-- ============================================================================

-- ============================================================================
-- All Mountains — peaks-first schema
--
-- Replaces the trail-first design. A summit is the primary entity; a route
-- cannot exist without one. Run this ONCE, top to bottom, in the Supabase SQL
-- editor on a fresh project.
--
-- Design constraints carried over from the incident that destroyed the last
-- database (1,519 MB in `routes` alone, read-only at 95% disk):
--
--   * No jsonb tag blobs. Storing every OSM tag cost ~22 MB for six fields the
--     UI ever read. Only promoted columns here.
--   * No PostGIS geography column. A geometry column plus its derived
--     geography cost ~185 MB across the catalogue; an encoded polyline plus
--     four bbox floats does the same job in ~4 MB and needs no extension.
--   * Text that can grow without bound (summaries) is capped, so a runaway
--     enrichment cannot TOAST the table into oblivion.
--
-- Expected size when fully loaded: ~35 MB of the 500 MB free tier.
-- ============================================================================

-- Trigram search on peak names. Supabase installs extensions into the
-- `extensions` schema, so the operator class is referenced UNQUALIFIED below —
-- `public.gin_trgm_ops` is an error here.
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- peaks
-- ---------------------------------------------------------------------------
create table if not exists peaks (
  slug              text primary key
                    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name              text        not null check (length(name) between 1 and 200),
  country           text        not null,
  continent         text        not null,
  region            text,

  elevation_m       int         not null check (elevation_m between -500 and 9000),
  latitude          double precision not null check (latitude between -90 and 90),
  longitude         double precision not null check (longitude between -180 and 180),

  category          text        not null check (category in ('highpoint','top_peak','popular')),
  difficulty        text        not null check (difficulty in ('hike','scramble','technical')),

  -- enrichment (all nullable: a peak with no article is still a peak)
  prominence_m      int         check (prominence_m between 0 and 9000),
  isolation_km      double precision,
  range_name        text,
  summary           text        check (length(summary) <= 4000),
  wikipedia_url     text,
  wikidata_id       text,
  commons_category  text,
  hero_photo_url    text,
  best_season       text,
  osm_id            bigint,

  -- denormalised counters, maintained by trigger / RPC
  route_count       int         not null default 0,
  summit_count      int         not null default 0,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Full-text + trigram search over name and region.
alter table peaks
  add column if not exists search tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(region, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(country, '')), 'C')
  ) stored;

create index if not exists peaks_search_idx      on peaks using gin (search);
create index if not exists peaks_name_trgm_idx   on peaks using gin (name gin_trgm_ops);
create index if not exists peaks_country_idx     on peaks (country);
create index if not exists peaks_continent_idx   on peaks (continent);
create index if not exists peaks_category_idx    on peaks (category);
create index if not exists peaks_difficulty_idx  on peaks (difficulty);
create index if not exists peaks_elevation_idx   on peaks (elevation_m desc);
-- Bounding-box lookups for the map. A plain btree on each axis beats a spatial
-- index at this table size and costs no extension.
create index if not exists peaks_latlng_idx      on peaks (latitude, longitude);

-- ---------------------------------------------------------------------------
-- peak_photos — URLs only. Bytes live in the browser's Cache API, never here.
-- ---------------------------------------------------------------------------
create table if not exists peak_photos (
  id          bigserial primary key,
  peak_slug   text not null references peaks(slug) on delete cascade,
  url         text not null,
  thumb_url   text not null,
  width       int,
  height      int,
  credit      text,          -- Commons requires attribution; storing it is not optional
  license     text,
  sort_order  int  not null default 0,
  unique (peak_slug, url)
);
create index if not exists peak_photos_slug_idx on peak_photos (peak_slug, sort_order);

-- ---------------------------------------------------------------------------
-- routes — a route belongs to a peak. This single FK is the pivot.
-- ---------------------------------------------------------------------------
create table if not exists routes (
  id                    bigserial primary key,
  peak_slug             text not null references peaks(slug) on delete cascade,
  osm_id                bigint,
  name                  text,

  distance_km           double precision,
  ascent_m              int,
  descent_m             int,
  est_time_min          int,
  difficulty            text,
  route_type            text,         -- 'Loop' | 'Out & Back' | 'Point to Point'
  network               text,         -- iwn | nwn | rwn | lwn

  -- Geometry as a Google-encoded polyline; ';' separates segments.
  -- Decode with decodeSegments() in src/lib/polyline.ts.
  poly                  text not null,
  bbox_min_lat          double precision not null,
  bbox_min_lng          double precision not null,
  bbox_max_lat          double precision not null,
  bbox_max_lng          double precision not null,

  -- How directly this route serves the summit; drives the ordering on the
  -- peak page so the actual summit trail is not buried under a connector.
  distance_to_summit_m  int,
  is_summit_route       boolean not null default false,

  surface               text,
  operator              text,
  ref                   text,          -- trail number: "GR20", "T4", "#1203"
  description           text check (length(description) <= 2000),
  dog_access            text,
  bicycle               text,
  fee                   text,

  created_at            timestamptz not null default now(),
  unique (peak_slug, osm_id)
);
create index if not exists routes_peak_idx      on routes (peak_slug);
create index if not exists routes_summit_idx    on routes (peak_slug, is_summit_route, distance_to_summit_m);
create index if not exists routes_distance_idx  on routes (distance_km);
create index if not exists routes_bbox_idx      on routes (bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng);

-- Keep peaks.route_count honest without an application round-trip.
create or replace function sync_route_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE') then
    update peaks set route_count = greatest(route_count - 1, 0) where slug = old.peak_slug;
    return old;
  elsif (tg_op = 'INSERT') then
    update peaks set route_count = route_count + 1 where slug = new.peak_slug;
    return new;
  end if;
  return null;
end $$;

drop trigger if exists routes_count_trg on routes;
create trigger routes_count_trg
  after insert or delete on routes
  for each row execute function sync_route_count();

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique check (username ~ '^[a-z0-9_]{3,30}$'),
  display_name  text,
  avatar_url    text,
  bio           text check (length(bio) <= 500),
  home_latitude double precision,
  home_longitude double precision,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- summit_logs — the personal map's data source
-- ---------------------------------------------------------------------------
create table if not exists summit_logs (
  id               bigserial primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  peak_slug        text not null references peaks(slug) on delete cascade,
  summited_at      date not null,
  duration_minutes int,
  distance_km      double precision,
  elevation_gain_m int,
  route_id         bigint references routes(id) on delete set null,
  weather          text,
  conditions       text,
  notes            text check (length(notes) <= 4000),
  rating           int check (rating between 1 and 5),
  photos           text[],
  /** Recorded GPS track, encoded polyline, when logged from navigation. */
  track_poly       text,
  is_public        boolean not null default true,
  created_at       timestamptz not null default now()
);
create index if not exists summit_logs_user_idx on summit_logs (user_id, summited_at desc);
create index if not exists summit_logs_peak_idx on summit_logs (peak_slug);

-- ---------------------------------------------------------------------------
-- lists
-- ---------------------------------------------------------------------------
create table if not exists peak_lists (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (length(name) between 1 and 100),
  description text check (length(description) <= 500),
  is_public   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists peak_lists_user_idx on peak_lists (user_id);

create table if not exists list_items (
  id         bigserial primary key,
  list_id    bigint not null references peak_lists(id) on delete cascade,
  peak_slug  text   not null references peaks(slug) on delete cascade,
  created_at timestamptz not null default now(),
  unique (list_id, peak_slug)
);
create index if not exists list_items_list_idx on list_items (list_id);

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------
create table if not exists reviews (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  peak_slug  text not null references peaks(slug) on delete cascade,
  rating     int  not null check (rating between 1 and 5),
  -- Flagged trail conditions: Dry, Muddy, Snow, Icy, Scramble, Busy, …
  conditions text[],
  body       text check (length(body) <= 4000),
  hiked_on   date,
  created_at timestamptz not null default now(),
  unique (user_id, peak_slug)
);
create index if not exists reviews_peak_idx on reviews (peak_slug, created_at desc);

-- Average rating per peak, so the card and page don't each aggregate client-side.
create or replace view peak_ratings as
  select peak_slug, round(avg(rating)::numeric, 2) as avg_rating, count(*)::int as review_count
  from reviews group by peak_slug;

-- ---------------------------------------------------------------------------
-- Map viewport query. Bbox arithmetic, no PostGIS.
-- ---------------------------------------------------------------------------
create or replace function peaks_in_bounds(
  min_lat double precision, min_lng double precision,
  max_lat double precision, max_lng double precision,
  max_rows int default 500
) returns setof peaks
language sql stable as $$
  select * from peaks
  where latitude between min_lat and max_lat
    and longitude between min_lng and max_lng
  order by elevation_m desc
  limit max_rows;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
--   Catalogue (peaks, photos, routes) is world-readable, writable only by the
--   service role used by the loader. User data is owner-scoped.
-- ---------------------------------------------------------------------------
alter table peaks        enable row level security;
alter table peak_photos  enable row level security;
alter table routes       enable row level security;
alter table profiles     enable row level security;
alter table summit_logs  enable row level security;
alter table peak_lists   enable row level security;
alter table list_items   enable row level security;
alter table reviews      enable row level security;

drop policy if exists peaks_read   on peaks;
drop policy if exists photos_read  on peak_photos;
drop policy if exists routes_read  on routes;
create policy peaks_read  on peaks       for select using (true);
create policy photos_read on peak_photos for select using (true);
create policy routes_read on routes      for select using (true);

drop policy if exists profiles_read on profiles;
drop policy if exists profiles_write on profiles;
create policy profiles_read  on profiles for select using (true);
create policy profiles_write on profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists logs_read on summit_logs;
drop policy if exists logs_write on summit_logs;
create policy logs_read  on summit_logs for select
  using (is_public or auth.uid() = user_id);
create policy logs_write on summit_logs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists lists_read on peak_lists;
drop policy if exists lists_write on peak_lists;
create policy lists_read  on peak_lists for select
  using (is_public or auth.uid() = user_id);
create policy lists_write on peak_lists for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists items_read on list_items;
drop policy if exists items_write on list_items;
create policy items_read on list_items for select using (
  exists (select 1 from peak_lists l
          where l.id = list_items.list_id and (l.is_public or l.user_id = auth.uid()))
);
create policy items_write on list_items for all using (
  exists (select 1 from peak_lists l where l.id = list_items.list_id and l.user_id = auth.uid())
) with check (
  exists (select 1 from peak_lists l where l.id = list_items.list_id and l.user_id = auth.uid())
);

drop policy if exists reviews_read on reviews;
drop policy if exists reviews_write on reviews;
create policy reviews_read  on reviews for select using (true);
create policy reviews_write on reviews for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on peaks, peak_photos, routes to anon, authenticated;
grant select on profiles, summit_logs, peak_lists, list_items, reviews to anon, authenticated;
grant insert, update, delete on summit_logs, peak_lists, list_items, reviews, profiles to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function peaks_in_bounds(double precision, double precision, double precision, double precision, int) to anon, authenticated;

-- Create a profile row automatically on signup.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

select 'peaks-first schema ready' as status,
       pg_size_pretty(pg_database_size(current_database())) as db_size;

-- ============================================================================
-- Canonical famous summits + "Beginner Hikes" starter list
-- Run ONCE in the Supabase SQL editor (this project has no migration tooling).
-- Idempotent: safe to re-run. Uses the service role via the SQL editor, so it
-- bypasses RLS for the seed.
--
-- WHY THIS EXISTS
-- The OSM import labels several famous summits oddly or omits them:
--   • Mount Rainier's summit node is named "Columbia Crest"
--   • Mount Shasta / Baker / Adams / St. Helens / Hood(OR) aren't present by name
-- so you can't find them by typing their common name. This inserts clean,
-- canonical, searchable rows for them (and other iconic peaks), with is_iconic
-- so they rank in "Most popular".
-- ============================================================================

-- Synthetic osm_ids use the -9_000_000 range so they never collide with real
-- OSM node ids. `on conflict (osm_id) do nothing` makes the whole file re-runnable.

-- 1. TIER A — the 8 beginner mountains' true summits, confirmed missing/misnamed.
--    Inserted unconditionally (canonical name) so they're always searchable.
insert into public.peaks (osm_id, name, name_en, elevation, latitude, longitude, location, country, region, is_iconic)
select v.osm_id, v.name, v.name, v.elevation, v.lat, v.lng,
       ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography,
       v.country, v.region, true
from (values
  (-9000001, 'Mount Rainier',    4392, 46.8523, -121.7603, 'United States', 'Washington'),
  (-9000002, 'Mount Hood',       3429, 45.3735, -121.6959, 'United States', 'Oregon'),
  (-9000003, 'Mount Baker',      3286, 48.7767, -121.8144, 'United States', 'Washington'),
  (-9000004, 'Mount Shasta',     4322, 41.4092, -122.1949, 'United States', 'California'),
  (-9000005, 'Mount Adams',      3743, 46.2024, -121.4909, 'United States', 'Washington'),
  (-9000006, 'Mount St. Helens', 2549, 46.1912, -122.1944, 'United States', 'Washington')
) as v(osm_id, name, elevation, lat, lng, country, region)
on conflict (osm_id) do nothing;

-- 2. TIER B — other world/US-famous summits people search for. Proximity-guarded:
--    inserted ONLY if no peak already exists within ~4 km, so we never duplicate
--    an already-imported summit (e.g. if Whitney/Fuji are already in the data).
insert into public.peaks (osm_id, name, name_en, elevation, latitude, longitude, location, country, region, is_iconic)
select v.osm_id, v.name, v.name, v.elevation, v.lat, v.lng,
       ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography,
       v.country, v.region, true
from (values
  -- United States
  (-9000101, 'Denali',              6190, 63.0692, -151.0070, 'United States', 'Alaska'),
  (-9000102, 'Mount Whitney',       4421, 36.5785, -118.2923, 'United States', 'California'),
  (-9000103, 'Grand Teton',         4199, 43.7412, -110.8024, 'United States', 'Wyoming'),
  (-9000104, 'Longs Peak',          4346, 40.2549, -105.6151, 'United States', 'Colorado'),
  (-9000105, 'Pikes Peak',          4302, 38.8405, -105.0442, 'United States', 'Colorado'),
  (-9000106, 'Mount Elbert',        4401, 39.1178, -106.4454, 'United States', 'Colorado'),
  (-9000107, 'Half Dome',           2694, 37.7460, -119.5330, 'United States', 'California'),
  (-9000108, 'Mount Katahdin',      1606, 45.9044,  -68.9216, 'United States', 'Maine'),
  (-9000109, 'Mauna Kea',           4207, 19.8207, -155.4681, 'United States', 'Hawaii'),
  (-9000110, 'Mount Mitchell',      2037, 35.7648,  -82.2652, 'United States', 'North Carolina'),
  (-9000111, 'Mount Timpanogos',    3582, 40.3908, -111.6461, 'United States', 'Utah'),
  -- Canada
  (-9000120, 'Mount Robson',        3954, 53.1069, -119.1558, 'Canada', 'British Columbia'),
  (-9000121, 'Mount Assiniboine',   3618, 50.8672, -115.6531, 'Canada', 'British Columbia'),
  -- Switzerland
  (-9000130, 'Matterhorn',          4478, 45.9763,    7.6586, 'Switzerland', 'Valais'),
  (-9000131, 'Dufourspitze',        4634, 45.9369,    7.8669, 'Switzerland', 'Valais'),
  (-9000132, 'Jungfrau',            4158, 46.5367,    7.9625, 'Switzerland', 'Bern'),
  (-9000133, 'Eiger',               3967, 46.5775,    8.0053, 'Switzerland', 'Bern'),
  -- Japan
  (-9000140, 'Mount Fuji',          3776, 35.3606,  138.7274, 'Japan', 'Shizuoka'),
  (-9000141, 'Mount Kita',          3193, 35.6745,  138.2392, 'Japan', 'Yamanashi'),
  (-9000142, 'Mount Yari',          3180, 36.3419,  137.6475, 'Japan', 'Nagano'),
  (-9000143, 'Mount Tate',          3015, 36.5772,  137.6197, 'Japan', 'Toyama')
) as v(osm_id, name, elevation, lat, lng, country, region)
where not exists (
  select 1 from public.peaks p
  where p.latitude  between v.lat - 0.04 and v.lat + 0.04
    and p.longitude between v.lng - 0.04 and v.lng + 0.04
)
on conflict (osm_id) do nothing;

-- 3. "Beginner Hikes" list, owned by your account, public.
--    Requires you to have signed up with this email first.
insert into public.peak_lists (user_id, name, description, is_public)
select u.id, 'Beginner Hikes', 'Classic, approachable summits to start with.', true
from auth.users u
where u.email = 'aidendrepaniotis@gmail.com'
  and not exists (
    select 1 from public.peak_lists pl
    where pl.user_id = u.id and pl.name = 'Beginner Hikes'
  );

-- 4. Seed the 8 beginner peaks into the list (Rainier, Hood, Baker, Shasta,
--    Adams, St. Helens via synthetic ids; Washington & Marcy already exist).
insert into public.list_items (list_id, peak_id)
select pl.id, p.id
from public.peak_lists pl
join auth.users u on u.id = pl.user_id and u.email = 'aidendrepaniotis@gmail.com'
join public.peaks p
  on p.osm_id in (-9000001, -9000002, -9000003, -9000004, -9000005, -9000006)
  or p.name ilike 'Mount Washington' and p.country = 'United States' and p.elevation between 1900 and 1930
  or p.name ilike 'Mount Marcy'      and p.country = 'United States' and p.elevation between 1620 and 1640
where pl.name = 'Beginner Hikes'
on conflict do nothing;

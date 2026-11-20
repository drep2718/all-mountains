-- The height a route actually reaches.
--
-- `distance_to_summit_m` measures the gap to the summit in plan view, and on
-- its own it misdescribes a mountain. Juneau's Perseverance Trail passes
-- 104 m from the summit and stops 830 m below it; the page said "104 m
-- short", which reads as "very nearly there" and means the opposite.
--
-- Storing the route's high point lets the page say how far below the top it
-- ends, which is the number a climber is actually asking for. It is also
-- what `is_summit_route` is derived from in load-catalogue.ts, so keeping it
-- on the row makes that decision auditable from the database instead of only
-- from a local NDJSON file.
--
-- Nullable: routes imported before the elevation pass have no measurement,
-- and a wrong number here would be worse than an absent one.

alter table routes add column if not exists high_point_m int;

comment on column routes.high_point_m is
  'Highest elevation on the route in metres, sampled from the Mapbox terrain '
  'DEM by scripts/catalogue/elevation-pass.ts. Compare with peaks.elevation_m '
  'for the vertical gap to the summit. Null means not yet measured.';

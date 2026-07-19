import type { Difficulty } from "./types";

export interface Filters {
  difficulty: Difficulty[];
  routeType: string[];
  activities: string[];
  features: string[];
  lengthMin: number; // km
  lengthMax: number; // km, 50 = "50+"
  iconicOnly: boolean; // show only the ~100 iconic summits
}

export const DEFAULT_FILTERS: Filters = {
  difficulty: [],
  routeType: [],
  activities: [],
  features: [],
  lengthMin: 0,
  lengthMax: 50,
  iconicOnly: false,
};

export const LENGTH_CAP = 50; // km; slider max, treated as "no upper limit"

export const DIFFICULTIES: Difficulty[] = ["Easy", "Moderate", "Hard", "Expert", "Extreme"];
export const ROUTE_TYPES = ["Loop", "Out & Back", "Point to Point"];

// Activities — only Hiking has data today (we import route=hiking). The rest are
// wired for when we import route=foot / route=bicycle / route=running relations.
export const ACTIVITIES = ["Hiking", "Walking", "Trail running", "Running", "Mountain biking", "Road biking"];

// Features — surfaced once we run a nearby-POI enrichment pass (natural=waterfall,
// tourism=viewpoint, natural=water, etc). "Summits" already works via route_peaks.
export const FEATURES = ["Summits", "Views", "Waterfalls", "Lakes", "Rivers", "Forests", "Wildlife", "Historic sites"];

export function activeFilterCount(f: Filters): number {
  return (
    f.difficulty.length +
    f.routeType.length +
    f.activities.length +
    f.features.length +
    (f.lengthMin > 0 || f.lengthMax < LENGTH_CAP ? 1 : 0) +
    (f.iconicOnly ? 1 : 0)
  );
}

export function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

// Apply the filters that have real backing data to a Supabase `routes` query.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRouteFilters(query: any, f: Filters) {
  if (f.difficulty.length) query = query.in("difficulty", f.difficulty);
  if (f.routeType.length) query = query.in("route_type", f.routeType);
  if (f.lengthMin > 0) query = query.gte("distance_km", f.lengthMin);
  if (f.lengthMax < LENGTH_CAP) query = query.lte("distance_km", f.lengthMax);
  // Features: route must contain ALL selected feature tags
  if (f.features.length) query = query.contains("features", f.features);
  return query;
}

// Client-side predicate for filtering already-loaded routes (used on the map).
export function routeMatches(
  r: { difficulty: string | null; route_type: string | null; distance_km: number | null; features?: string[] | null },
  f: Filters
): boolean {
  if (f.difficulty.length && !f.difficulty.includes(r.difficulty as Difficulty)) return false;
  if (f.routeType.length && (!r.route_type || !f.routeType.includes(r.route_type))) return false;
  if (f.features.length && !f.features.every((x) => (r.features ?? []).includes(x))) return false;
  if (r.distance_km != null) {
    if (r.distance_km < f.lengthMin) return false;
    if (f.lengthMax < LENGTH_CAP && r.distance_km > f.lengthMax) return false;
  }
  return true;
}

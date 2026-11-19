/**
 * The peaks-first domain model.
 *
 * A summit is the primary entity and is identified by a slug
 * ("mount-rainier-united-states"), not an OSM id. Three reasons:
 *   - the seed is idempotent and re-runnable
 *   - URLs read as /peaks/mount-rainier-united-states
 *   - the catalogue is decoupled from OSM churn, and from the import pipeline
 *     whose re-runs filled the last database
 *
 * A Route belongs to a Peak. There is no free-floating trail.
 */

export type PeakCategory = "highpoint" | "top_peak" | "popular";
export type PeakDifficulty = "hike" | "scramble" | "technical";

export interface Peak {
  slug: string;
  name: string;
  country: string;
  continent: string;
  region: string | null;

  elevation_m: number;
  latitude: number;
  longitude: number;

  category: PeakCategory;
  difficulty: PeakDifficulty;

  prominence_m: number | null;
  isolation_km: number | null;
  range_name: string | null;
  summary: string | null;
  wikipedia_url: string | null;
  wikidata_id: string | null;
  commons_category: string | null;
  hero_photo_url: string | null;
  best_season: string | null;
  osm_id: number | null;

  route_count: number;
  summit_count: number;

  /** Joined in by some queries. */
  photos?: PeakPhoto[];
  routes?: PeakRoute[];
}

export interface PeakPhoto {
  id: number;
  peak_slug: string;
  url: string;
  thumb_url: string;
  width: number | null;
  height: number | null;
  /** Commons requires attribution. Never render a photo without it. */
  credit: string | null;
  license: string | null;
  sort_order: number;
}

export interface PeakRoute {
  id: number;
  peak_slug: string;
  osm_id: number | null;
  name: string | null;
  network: string | null;

  distance_km: number | null;
  ascent_m: number | null;
  descent_m: number | null;
  est_time_min: number | null;
  difficulty: string | null;
  route_type: string | null;

  /** Encoded polyline; ';' separates segments. Decode with decodeSegments(). */
  poly: string;
  bbox_min_lat: number;
  bbox_min_lng: number;
  bbox_max_lat: number;
  bbox_max_lng: number;

  distance_to_summit_m: number | null;
  is_summit_route: boolean;

  surface: string | null;
  operator: string | null;
  ref: string | null;
  description: string | null;
  dog_access: string | null;
  bicycle: string | null;
  fee: string | null;
}

export interface SummitLog {
  id: number;
  user_id: string;
  peak_slug: string;
  summited_at: string;
  duration_minutes: number | null;
  distance_km: number | null;
  elevation_gain_m: number | null;
  route_id: number | null;
  weather: string | null;
  conditions: string | null;
  notes: string | null;
  rating: number | null;
  photos: string[] | null;
  track_poly: string | null;
  is_public: boolean;
  created_at: string;
  peak?: Peak;
}

// --- presentation ---------------------------------------------------------

export const CATEGORY_LABEL: Record<PeakCategory, string> = {
  highpoint: "Highpoint",
  top_peak: "Major peak",
  popular: "Popular",
};

export const DIFFICULTY_LABEL: Record<PeakDifficulty, string> = {
  hike: "Hike",
  scramble: "Scramble",
  technical: "Technical",
};

/**
 * Difficulty is a property of the climb, not of the elevation. The old model
 * derived it from height, which called every 4,000 m peak "Extreme" and every
 * 800 m one "Easy" — Half Dome's cables and Camelback's scramble both came out
 * as strolls. The curated list states it directly; use that.
 */
export const DIFFICULTY_HEX: Record<PeakDifficulty, string> = {
  hike: "#2e7d4f",
  scramble: "#c07a1d",
  technical: "#c23b32",
};

export const CATEGORY_HEX: Record<PeakCategory, string> = {
  highpoint: "#e8b33a",
  top_peak: "#8a7bc8",
  popular: "#4a7fb5",
};

export function difficultyClasses(d: PeakDifficulty): string {
  switch (d) {
    // Light theme: dark text on a pale tint. The app defines no dark palette,
    // so "-300 text on -900/15" reads as pale-on-pale.
    case "hike":
      return "bg-emerald-50 text-emerald-900 ring-emerald-300";
    case "scramble":
      return "bg-amber-50 text-amber-900 ring-amber-400";
    case "technical":
      return "bg-red-50 text-red-900 ring-red-300";
  }
}

export const metresToFeet = (m: number) => Math.round(m * 3.28084);

export function formatElevation(m: number | null): string {
  if (m == null) return "—";
  return `${m.toLocaleString()} m · ${metresToFeet(m).toLocaleString()} ft`;
}

export function formatDuration(minutes: number | null): string {
  if (!minutes || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatDistance(km: number | null): string {
  if (km == null) return "—";
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/**
 * Peaks with no mapped trail are not a data gap — a technical peak often has
 * no path because you climb it. Say so rather than showing an empty list.
 */
export function noRoutesMessage(peak: Pick<Peak, "difficulty">): string {
  return peak.difficulty === "technical"
    ? "No mapped walking trail — this summit is a climb."
    : "No mapped trail reaches this summit yet.";
}

export function accessInfo(
  route: Pick<PeakRoute, "dog_access" | "bicycle" | "fee">
): string[] {
  const out: string[] = [];
  if (route.dog_access === "yes" || route.dog_access === "leashed") out.push("Dogs allowed");
  if (route.dog_access === "no") out.push("No dogs");
  if (route.bicycle === "yes") out.push("Bikes allowed");
  if (route.fee === "yes") out.push("Entry fee");
  return out;
}

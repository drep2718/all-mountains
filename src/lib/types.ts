export interface Peak {
  id: number;
  osm_id: number;
  name: string | null;
  name_en: string | null;
  elevation: number | null;
  prominence: number | null;
  latitude: number;
  longitude: number;
  country: string | null;
  region: string | null;
  wikipedia_url: string | null;
  photo_url: string | null;
  difficulty: string | null;
  description: string | null;
  is_iconic?: boolean;
  tags: Record<string, string>;
  created_at: string;
}

// Gold used to highlight the ~100 iconic summits
export const ICONIC_HEX = "#e8b33a";

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  home_latitude: number | null;
  home_longitude: number | null;
  search_radius_km: number;
  created_at: string;
  updated_at: string;
}

export interface SummitLog {
  id: number;
  user_id: string;
  peak_id: number;
  summited_at: string;
  duration_minutes: number | null;
  distance_km: number | null;
  elevation_gain_m: number | null;
  weather: string | null;
  conditions: string | null;
  notes: string | null;
  rating: number | null;
  photos: string[] | null;
  is_public: boolean;
  created_at: string;
  peak?: Peak;
}

export interface PeakList {
  id: number;
  user_id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
}

export interface Route {
  id: number;
  osm_id: number;
  name: string | null;
  network: string | null;      // e.g. "iwn", "nwn", "rwn", "lwn"
  distance_km: number | null;
  difficulty: string | null;    // sac_scale derived
  ascent_m: number | null;
  descent_m: number | null;
  route_type: string | null;    // "Loop" | "Out & Back"
  est_time_min: number | null;  // Naismith estimate
  features: string[] | null;    // Views / Waterfalls / Lakes / Summits ...
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  bbox_min_lat: number;
  bbox_min_lng: number;
  bbox_max_lat: number;
  bbox_max_lng: number;
  country: string | null;
  region: string | null;
  description: string | null;
  tags: Record<string, string>;
  peak_count?: number;
}

// Human-friendly names for OSM network scope
export const NETWORK_LABEL: Record<string, string> = {
  iwn: "International route",
  nwn: "National route",
  rwn: "Regional route",
  lwn: "Local route",
};

// Human-friendly names for OSM surface tag
export function surfaceLabel(surface?: string): string | null {
  if (!surface) return null;
  return surface
    .split(/[;_]/)[0]
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatDuration(minutes: number | null): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// AllTrails-style access info pulled from OSM tags
export function accessInfo(tags: Record<string, string> = {}): string[] {
  const out: string[] = [];
  if (tags.dog === "yes" || tags.dog === "leashed") out.push("Dogs allowed");
  if (tags.dog === "no") out.push("No dogs");
  if (tags.bicycle === "yes") out.push("Bikes allowed");
  if (tags.wheelchair === "yes") out.push("Wheelchair accessible");
  if (tags.fee === "yes") out.push("Entry fee");
  if (tags.toll === "yes") out.push("Toll");
  return out;
}

export type Difficulty = "Easy" | "Moderate" | "Hard" | "Expert" | "Extreme";

export function getDifficulty(elevation: number | null): Difficulty {
  if (!elevation) return "Easy";
  if (elevation < 1000) return "Easy";
  if (elevation < 2000) return "Moderate";
  if (elevation < 3000) return "Hard";
  if (elevation < 4000) return "Expert";
  return "Extreme";
}

export const DIFFICULTY_HEX: Record<Difficulty, string> = {
  Easy: "#4fb477",
  Moderate: "#4f9dc7",
  Hard: "#e0b44f",
  Expert: "#e8814e",
  Extreme: "#e0574e",
};

export function getDifficultyColor(difficulty: Difficulty): string {
  switch (difficulty) {
    case "Easy": return "bg-diff-easy/15 text-diff-easy";
    case "Moderate": return "bg-diff-moderate/15 text-diff-moderate";
    case "Hard": return "bg-diff-hard/15 text-diff-hard";
    case "Expert": return "bg-diff-expert/15 text-diff-expert";
    case "Extreme": return "bg-diff-extreme/15 text-diff-extreme";
  }
}

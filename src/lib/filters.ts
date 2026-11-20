import type { PeakDifficulty, Peak } from "./peak-types";

export interface Filters {
  difficulty: PeakDifficulty[];
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

// A climb's grade, as the catalogue states it — not a band derived from height.
export const DIFFICULTIES: PeakDifficulty[] = ["hike", "scramble", "technical"];
export const ROUTE_TYPES = ["Loop", "Out & Back", "Point to Point"];

// Only options backed by the peaks-first catalogue are selectable.
export const ACTIVITIES = ["Hiking"];
export const FEATURES = ["Summits"];

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
  if (f.difficulty.length) query = query.in("peak.difficulty", f.difficulty);
  if (f.routeType.length) query = query.in("route_type", f.routeType);
  if (f.lengthMin > 0) query = query.gte("distance_km", f.lengthMin);
  if (f.lengthMax < LENGTH_CAP) query = query.lte("distance_km", f.lengthMax);
  if (f.iconicOnly) query = query.eq("peak.category", "highpoint");
  if (f.features.includes("Summits")) query = query.eq("is_summit_route", true);
  return query;
}

// Client-side predicate for filtering already-loaded routes (used on the map).
export function routeMatches(
  r: { difficulty: string | null; route_type: string | null; distance_km: number | null; is_summit_route: boolean },
  f: Filters,
  peak?: Pick<Peak, "difficulty" | "category">
): boolean {
  if (f.difficulty.length && (!peak || !f.difficulty.includes(peak.difficulty))) return false;
  if (f.routeType.length && (!r.route_type || !f.routeType.includes(r.route_type))) return false;
  if (f.iconicOnly && peak?.category !== "highpoint") return false;
  if (f.features.includes("Summits") && !r.is_summit_route) return false;
  if (r.distance_km == null && (f.lengthMin > 0 || f.lengthMax < LENGTH_CAP)) return false;
  if (r.distance_km != null) {
    if (r.distance_km < f.lengthMin) return false;
    if (f.lengthMax < LENGTH_CAP && r.distance_km > f.lengthMax) return false;
  }
  return true;
}

// --- URL round-tripping ----------------------------------------------------

/**
 * Filters, compact enough to live in a query string.
 *
 * The browse pages keep their state in the URL so that pressing back after
 * opening a result returns you to the list you were looking at, rather than
 * to an unfiltered one. The filter sheet has to travel with the rest of it,
 * or back restores your search and silently drops your filters — which is
 * worse than losing both, because the page then looks right and is not.
 *
 * Encoded as `a.b.c` lists joined by `-`, skipping anything left at its
 * default, so a lightly filtered list keeps a short and readable URL.
 */
export function encodeFilters(f: Filters): string {
  const parts: string[] = [];
  if (f.difficulty.length) parts.push(`d.${f.difficulty.join(".")}`);
  if (f.routeType.length) parts.push(`t.${f.routeType.map((s) => s.replace(/\s+/g, "_")).join(".")}`);
  if (f.activities.length) parts.push(`a.${f.activities.map((s) => s.replace(/\s+/g, "_")).join(".")}`);
  if (f.features.length) parts.push(`f.${f.features.map((s) => s.replace(/\s+/g, "_")).join(".")}`);
  if (f.lengthMin > 0) parts.push(`lo.${f.lengthMin}`);
  if (f.lengthMax < LENGTH_CAP) parts.push(`hi.${f.lengthMax}`);
  if (f.iconicOnly) parts.push("ic.1");
  return parts.join("-");
}

/** Inverse of `encodeFilters`. Unknown or malformed parts are ignored. */
export function decodeFilters(raw: string): Filters {
  const out: Filters = {
    ...DEFAULT_FILTERS,
    difficulty: [],
    routeType: [],
    activities: [],
    features: [],
  };
  if (!raw) return out;

  for (const part of raw.split("-")) {
    const [tag, ...rest] = part.split(".");
    const values = rest.filter(Boolean).map((s) => s.replace(/_/g, " "));
    switch (tag) {
      case "d":
        // Only grades the catalogue actually uses; a hand-edited URL must
        // not put an unknown value into a query.
        out.difficulty = values.filter((v): v is PeakDifficulty =>
          (DIFFICULTIES as string[]).includes(v)
        );
        break;
      case "t":
        out.routeType = values.filter((v) => ROUTE_TYPES.includes(v));
        break;
      case "a":
        out.activities = values;
        break;
      case "f":
        out.features = values;
        break;
      case "lo": {
        const n = Number(rest[0]);
        if (Number.isFinite(n) && n >= 0) out.lengthMin = Math.min(n, LENGTH_CAP);
        break;
      }
      case "hi": {
        const n = Number(rest[0]);
        if (Number.isFinite(n) && n > 0) out.lengthMax = Math.min(n, LENGTH_CAP);
        break;
      }
      case "ic":
        out.iconicOnly = rest[0] === "1";
        break;
    }
  }
  // A reversed range matches nothing and reads as a bug in the page.
  if (out.lengthMin > out.lengthMax) out.lengthMin = 0;
  return out;
}

import { createClient } from "@/lib/supabase/client";
import type { Peak, Route } from "@/lib/types";

// A peak search result carries how many trails reach its summit — the tie-in
// that lets you go peak → trails from a single search.
export interface PeakResult extends Peak {
  trail_count: number;
}

// A route search result carries how many peaks it crosses (route → peaks).
export type RouteResult = Route;

export interface SearchResults {
  peaks: PeakResult[];
  routes: RouteResult[];
}

// Attach a count from a route_peaks link table keyed on the given column.
function tally(
  links: { peak_id?: number; route_id?: number }[],
  key: "peak_id" | "route_id"
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const link of links) {
    const id = link[key];
    if (id == null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// Lightweight peak-name lookup for the map/location search — just enough to
// place a pin and fly to it. Ordered iconic-then-tallest so "Rainier" surfaces
// the famous one first.
export interface PeakHit {
  id: number;
  name: string | null;
  latitude: number;
  longitude: number;
  elevation: number | null;
}

export async function searchPeaksByName(query: string, limit = 5): Promise<PeakHit[]> {
  const q = query.trim();
  if (!q) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from("peaks")
    .select("id,name,latitude,longitude,elevation")
    .ilike("name", `%${q}%`)
    .order("is_iconic", { ascending: false, nullsFirst: false })
    .order("elevation", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data ?? []) as unknown as PeakHit[]);
}

// Unified search across peaks AND trails in one call. Peaks come back with a
// trail_count (trails to that summit); routes with peak_count (peaks on route),
// so the result surfaces the bidirectional link the app is built around.
export async function searchAll(query: string, limit = 24): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return { peaks: [], routes: [] };

  const supabase = createClient();
  const like = `%${q}%`;

  const [peaksRes, routesRes] = await Promise.all([
    supabase
      .from("peaks")
      .select("*")
      .ilike("name", like)
      .order("is_iconic", { ascending: false, nullsFirst: false })
      .order("elevation", { ascending: false, nullsFirst: false })
      .limit(limit),
    supabase
      .from("routes")
      .select("*")
      .ilike("name", like)
      .order("distance_km", { ascending: false, nullsFirst: false })
      .limit(limit),
  ]);

  const peaks = ((peaksRes.data ?? []) as unknown as PeakResult[]).map((p) => ({
    ...p,
    trail_count: 0,
  }));
  const routes = ((routesRes.data ?? []) as unknown as RouteResult[]);

  // One round-trip each to count the cross-links, then join client-side.
  const [peakLinks, routeLinks] = await Promise.all([
    peaks.length
      ? supabase.from("route_peaks").select("peak_id").in("peak_id", peaks.map((p) => p.id))
      : Promise.resolve({ data: [] }),
    routes.length
      ? supabase.from("route_peaks").select("route_id").in("route_id", routes.map((r) => r.id))
      : Promise.resolve({ data: [] }),
  ]);

  const trailCounts = tally((peakLinks.data ?? []) as { peak_id: number }[], "peak_id");
  const peakCounts = tally((routeLinks.data ?? []) as { route_id: number }[], "route_id");

  for (const p of peaks) p.trail_count = trailCounts.get(p.id) ?? 0;
  for (const r of routes) r.peak_count = peakCounts.get(r.id) ?? 0;

  return { peaks, routes };
}

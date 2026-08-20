import { createClient } from "@/lib/supabase/client";
import { geocode } from "@/lib/geocode";
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
  // The mountain/place the query resolved to (via geocoding), if any — lets the
  // UI say "everything around Mount Rainier".
  place?: { name: string; center: [number, number] } | null;
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
/** Tolerance for "this trail reaches that summit", in degrees (~2 km). */
const NEAR_DEG = 0.02;

export interface PeakHit {
  id: number;
  name: string | null;
  latitude: number;
  longitude: number;
  elevation: number | null;
}

export async function searchPeaksByName(query: string, limit = 4): Promise<PeakHit[]> {
  const q = query.trim();
  if (!q) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from("peaks")
    .select("id,name,latitude,longitude,elevation")
    .ilike("name", `%${q}%`)
    .not("name", "is", null)          // never surface unnamed nodes
    .order("is_iconic", { ascending: false, nullsFirst: false })
    .order("prominence", { ascending: false, nullsFirst: false }) // real summits over sub-features
    .order("elevation", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data ?? []) as unknown as PeakHit[]);
}

// Unified, MOUNTAIN-FIRST search across peaks AND trails.
//
// Two things run in parallel: an exact name match (ilike) AND a geocode of the
// query. Geocoding is what makes "Mount Rainier" (stored as "Columbia Crest"),
// or even the typo "Mount Rainer", work: we resolve it to a location and then
// pull EVERY peak and trail around that mountain via the bounds RPCs — so a
// mountain search returns the peaks + trails you'd actually be doing there.
export async function searchAll(query: string, limit = 24): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return { peaks: [], routes: [], place: null };

  const supabase = createClient();
  const like = `%${q}%`;

  const [peaksRes, routesRes, places] = await Promise.all([
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
    geocode(q),
  ]);

  const peaks = ((peaksRes.data ?? []) as unknown as PeakResult[]).map((p) => ({
    ...p,
    trail_count: 0,
  }));
  const routes = ((routesRes.data ?? []) as unknown as RouteResult[]);

  // Resolve the query to a mountain. Geocoding can be ambiguous — "Mount
  // Rainier" returns both a town in Maryland and the volcano in Washington. This
  // is a mountains app, so we score each candidate by the tallest named peak
  // near it and pick the most mountainous one.
  const candidates = places.slice(0, 3).filter((c) => c.bbox);
  let place: { name: string; center: [number, number] } | null = null;

  if (candidates.length) {
    const peakSets = await Promise.all(
      candidates.map((c) => {
        const [minLng, minLat, maxLng, maxLat] = c.bbox!;
        return supabase.rpc("peaks_in_bounds", {
          min_lat: minLat, min_lng: minLng, max_lat: maxLat, max_lng: maxLng, min_elevation: 0, lim: 80,
        });
      })
    );

    let bestIdx = 0, bestScore = -1;
    peakSets.forEach((res, i) => {
      const score = ((res.data ?? []) as unknown as PeakResult[])
        .reduce((max, p) => (p.name ? Math.max(max, p.elevation ?? 0) : max), 0);
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    });

    const chosen = candidates[bestIdx];
    place = { name: chosen.name, center: chosen.center };

    const seenP = new Set(peaks.map((p) => p.id));
    for (const p of ((peakSets[bestIdx].data ?? []) as unknown as PeakResult[])) {
      if (!p.name || seenP.has(p.id)) continue; // named summits only — less noise
      seenP.add(p.id);
      peaks.push({ ...p, trail_count: 0 });
    }

    const [minLng, minLat, maxLng, maxLat] = chosen.bbox!;
    const areaRoutes = await supabase.rpc("routes_in_bounds", {
      min_lat: minLat, min_lng: minLng, max_lat: maxLat, max_lng: maxLng, lim: 40,
    });
    const seenR = new Set(routes.map((r) => r.id));
    for (const r of ((areaRoutes.data ?? []) as unknown as RouteResult[])) {
      if (seenR.has(r.id)) continue;
      seenR.add(r.id);
      routes.push(r);
    }
  }

  // Cross-link counts over the merged set (peak→trails, trail→peaks).
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

  // route_peaks is filled by a batch spatial job, so trails imported since it
  // last ran are missing from it and every peak would read "no mapped trails".
  // Both sets are already in memory here, so fall back to a bounding-box test.
  for (const p of peaks) {
    if (p.trail_count > 0) continue;
    p.trail_count = routes.filter(
      (r) =>
        r.bbox_min_lat != null &&
        p.latitude >= r.bbox_min_lat - NEAR_DEG &&
        p.latitude <= r.bbox_max_lat + NEAR_DEG &&
        p.longitude >= r.bbox_min_lng - NEAR_DEG &&
        p.longitude <= r.bbox_max_lng + NEAR_DEG
    ).length;
  }

  // Highest / most iconic first so the marquee summit leads.
  peaks.sort((a, b) =>
    Number(b.is_iconic ?? false) - Number(a.is_iconic ?? false) ||
    (b.elevation ?? 0) - (a.elevation ?? 0));

  return { peaks, routes, place: place ? { name: place.name, center: place.center } : null };
}

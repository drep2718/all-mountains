import { createClient } from "@/lib/supabase/client";
import { geocode } from "@/lib/geocode";
import type { Peak, PeakRoute } from "@/lib/peak-types";

/**
 * Mountain-first search.
 *
 * Much smaller than it used to be. The old version carried a `route_peaks`
 * join table, two tally passes and a bounding-box fallback for when the
 * spatial linking job hadn't caught up — all of it to answer "how many trails
 * reach this summit". A route now belongs to a peak and `peaks.route_count` is
 * kept by a trigger, so the question answers itself.
 */

export interface SearchResults {
  peaks: Peak[];
  routes: PeakRoute[];
  /** The mountain or place the query resolved to, if any. */
  place: { name: string; center: [number, number] } | null;
}

export interface PeakHit {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation_m: number;
}

/** Lightweight name lookup for the map's search box. */
export async function searchPeaksByName(query: string, limit = 6): Promise<PeakHit[]> {
  const q = query.trim();
  if (!q) return [];
  const { data } = await createClient()
    .from("peaks")
    .select("slug,name,latitude,longitude,elevation_m")
    .ilike("name", `%${q}%`)
    .order("category", { ascending: true }) // highpoint < popular < top_peak
    .order("prominence_m", { ascending: false, nullsFirst: false })
    .order("elevation_m", { ascending: false })
    .limit(limit);
  return (data ?? []) as PeakHit[];
}

/**
 * Search peaks by name, and — because a mountain's name and its summit's name
 * often differ ("Mount Rainier" vs "Columbia Crest"), and because people
 * mistype — also geocode the query and return every peak around the place it
 * resolves to.
 */
export async function searchAll(query: string, limit = 24): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return { peaks: [], routes: [], place: null };

  const supabase = createClient();
  const like = `%${q}%`;

  const [byName, places] = await Promise.all([
    supabase
      .from("peaks")
      .select("*")
      .ilike("name", like)
      .order("category", { ascending: true })
      .order("prominence_m", { ascending: false, nullsFirst: false })
      .order("elevation_m", { ascending: false })
      .limit(limit),
    geocode(q),
  ]);

  const peaks = (byName.data ?? []) as Peak[];
  const seen = new Set(peaks.map((p) => p.slug));

  // Geocoding is ambiguous — "Mount Rainier" returns both a town in Maryland
  // and the volcano. This is a mountains app, so score each candidate by the
  // tallest peak near it and take the most mountainous.
  let place: SearchResults["place"] = null;
  const candidates = places.slice(0, 3).filter((c) => c.bbox);

  if (candidates.length) {
    const sets = await Promise.all(
      candidates.map((c) => {
        const [minLng, minLat, maxLng, maxLat] = c.bbox!;
        return supabase
          .from("peaks")
          .select("*")
          .gte("latitude", minLat)
          .lte("latitude", maxLat)
          .gte("longitude", minLng)
          .lte("longitude", maxLng)
          .order("elevation_m", { ascending: false })
          .limit(60);
      })
    );

    let bestIdx = 0;
    let bestScore = -1;
    sets.forEach((res, i) => {
      const score = ((res.data ?? []) as Peak[]).reduce(
        (max, p) => Math.max(max, p.elevation_m),
        0
      );
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    });

    const chosen = candidates[bestIdx];
    place = { name: chosen.name, center: chosen.center };

    for (const p of (sets[bestIdx].data ?? []) as Peak[]) {
      if (seen.has(p.slug)) continue;
      seen.add(p.slug);
      peaks.push(p);
    }
  }

  // Routes for whatever peaks we found. One query, no join table.
  let routes: PeakRoute[] = [];
  if (peaks.length) {
    const { data } = await supabase
      .from("routes")
      .select("*")
      .in(
        "peak_slug",
        peaks.slice(0, 40).map((p) => p.slug)
      )
      .order("is_summit_route", { ascending: false })
      .order("distance_to_summit_m")
      .limit(limit * 2);
    routes = (data ?? []) as PeakRoute[];
  }

  // Highpoints first, then the most prominent — the marquee summit leads.
  const rank: Record<string, number> = { highpoint: 0, top_peak: 1, popular: 2 };
  peaks.sort(
    (a, b) =>
      (rank[a.category] ?? 3) - (rank[b.category] ?? 3) ||
      (b.prominence_m ?? 0) - (a.prominence_m ?? 0) ||
      b.elevation_m - a.elevation_m
  );

  return { peaks, routes, place };
}

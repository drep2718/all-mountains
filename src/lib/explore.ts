import { createClient } from "@/lib/supabase/client";
import type { Peak, PeakRoute } from "@/lib/peak-types";

export interface ExploreBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  zoom: number;
}

/** Split wrapped Mapbox bounds into boxes PostGIS can query. */
export function longitudeRanges(min: number, max: number): [number, number][] {
  if (max - min >= 360) return [[-180, 180]];
  const west = ((min + 180) % 360 + 360) % 360 - 180;
  const east = west + ((max - min + 360) % 360);
  return east <= 180 ? [[west, east]] : [[west, 180], [-180, east - 360]];
}

/** Fetch routes through their summit FK; the old spatial route RPC was removed. */
export async function fetchExploreBounds(
  bounds: ExploreBounds,
  includeRoutes = true,
  signal?: AbortSignal
): Promise<{ peaks: Peak[]; routes: PeakRoute[] }> {
  const db = createClient();
  const responses = await Promise.all(longitudeRanges(bounds.minLng, bounds.maxLng).map(async ([west, east]) => {
    let q = db.rpc("peaks_in_bounds", {
      min_lat: Math.max(-90, bounds.minLat), min_lng: west,
      max_lat: Math.min(90, bounds.maxLat), max_lng: east, max_rows: 400,
    });
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) throw new Error(`Couldn't load peaks: ${error.message}`);
    return (data ?? []) as Peak[];
  }));
  const peaks = [...new Map(responses.flat().map((p) => [p.slug, p])).values()];
  if (!includeRoutes || bounds.zoom < 6 || !peaks.length) return { peaks, routes: [] };

  let q = db.from("routes").select("*")
    .in("peak_slug", peaks.map((p) => p.slug))
    .order("is_summit_route", { ascending: false })
    .order("distance_to_summit_m", { nullsFirst: false })
    .order("id")
    .limit(100);
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) throw new Error(`Couldn't load routes: ${error.message}`);
  return { peaks, routes: (data ?? []) as PeakRoute[] };
}

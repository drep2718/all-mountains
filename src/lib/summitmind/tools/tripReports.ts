/**
 * Community trip reports — fetch, submit, flag. Straight Supabase CRUD
 * against the `trip_reports` table (supabase/migrations/20260903000100_trip_reports.sql),
 * same shape as tools/experience.ts. Fully written — there's no interesting
 * plumbing decision here, the interesting decision is what a node does with
 * these once fetched (see graph/nodes/checkCommunityReports.ts).
 */

import { createClient } from "@/lib/supabase/server";
import type { CommunityTripReport } from "../types";

const NEARBY_RADIUS_DEGREES = 0.05; // ~5.5km at the equator — a bounding-box prefilter, not precise geo distance

export async function fetchNearbyTripReports(lat: number, lon: number): Promise<CommunityTripReport[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trip_reports")
    .select("id, body, posted_at, profiles(display_name)")
    .eq("is_hidden", false)
    .gte("lat", lat - NEARBY_RADIUS_DEGREES)
    .lte("lat", lat + NEARBY_RADIUS_DEGREES)
    .gte("lon", lon - NEARBY_RADIUS_DEGREES)
    .lte("lon", lon + NEARBY_RADIUS_DEGREES)
    .order("posted_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(`Failed to fetch trip reports: ${error.message}`);

  return (data ?? []).map((row) => ({
    author: (row.profiles as unknown as { display_name: string } | null)?.display_name ?? "Anonymous",
    postedAt: row.posted_at,
    body: row.body,
  }));
}

export async function submitTripReport(params: { userId: string; lat: number; lon: number; body: string }) {
  const supabase = await createClient();
  const { error } = await supabase.from("trip_reports").insert({
    user_id: params.userId,
    lat: params.lat,
    lon: params.lon,
    body: params.body,
  });
  if (error) throw new Error(`Failed to submit trip report: ${error.message}`);
}

/** One flag per user per report enforced by a unique constraint in the migration — insert failing is expected on a double-flag, not a bug. */
export async function flagTripReport(reportId: number, userId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("trip_report_flags").insert({ report_id: reportId, user_id: userId });
  if (error && error.code !== "23505" /* unique_violation — already flagged, treat as success */) {
    throw new Error(`Failed to flag trip report: ${error.message}`);
  }
}

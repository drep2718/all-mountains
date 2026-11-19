/**
 * Experience profile — pulls the signed-in user's own summit_logs so the
 * agent can tune its answer to them, instead of giving the same generic
 * plan to a first-timer and someone with forty summits logged.
 */

import { createClient } from "@/lib/supabase/server";
import type { ExperienceProfile } from "../types";

/** Plumbing — same query shape you already use elsewhere against summit_logs/peaks. Fully written. */
export async function fetchRawSummitLogs(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("summit_logs")
    .select("id, summited_at, peaks(elevation_m, name)")
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to fetch summit logs: ${error.message}`);
  return data;
}

// TODO: turn the raw log rows into an ExperienceProfile. The interesting
// design question isn't the aggregation math (max elevation, count — trivial)
// it's what "risk-aware personalization" should actually mean downstream:
//
//   - This profile should never be used to *block* a plan — the user always
//     makes the final call. It's used in synthesize.ts to decide whether the
//     answer needs an explicit note like "this is a bigger jump in elevation/
//     season difficulty than your logged history — plan accordingly."
//   - `hasGlacierExperience` / `hasWinterExperience`: you'll need some way to
//     infer these from the data you actually have (route tags? a season check
//     on summited_at? a manual flag on the log?) — worth deciding what's
//     honestly inferable vs. what you'd be guessing at.
export async function getExperienceProfile(userId: string): Promise<ExperienceProfile> {
  const logs = await fetchRawSummitLogs(userId);
  throw new Error("TODO: aggregate logs -> ExperienceProfile, see comment above");
}

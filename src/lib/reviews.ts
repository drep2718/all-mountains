import { createClient } from "@/lib/supabase/client";

export interface Review {
  id: number;
  user_id: string;
  peak_slug: string;
  rating: number;
  body: string | null;
  conditions: string[] | null;
  hiked_on: string | null;
  created_at: string;
}

export interface RatingSummary {
  avg: number | null;
  count: number;
}

/**
 * Reviews attach to a mountain, not a trail. A route belongs to a peak now, so
 * "what was the trail like" and "what was the mountain like" are the same
 * question, asked in one place.
 */

/** Trail conditions a hiker can flag, mirroring what AllTrails collects. */
export const CONDITION_OPTIONS = [
  "Dry", "Muddy", "Snow", "Icy", "Overgrown",
  "Bugs", "Washed out", "Blowdown", "Scramble", "Busy",
] as const;

/**
 * Until the schema is applied, PostgREST answers with "relation does not
 * exist". Treating that as "no reviews yet" keeps peak pages fully working on
 * a database mid-migration, instead of showing an error for a missing table.
 */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "42P01" || /does not exist/i.test(err.message ?? "");
}

export async function fetchReviews(peakSlug: string): Promise<Review[]> {
  const { data, error } = await createClient()
    .from("reviews")
    .select("*")
    .eq("peak_slug", peakSlug)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as Review[];
}

export async function fetchRating(peakSlug: string): Promise<RatingSummary> {
  const { data, error } = await createClient()
    .from("peak_ratings")
    .select("avg_rating,review_count")
    .eq("peak_slug", peakSlug)
    .maybeSingle();
  if (error || !data) return { avg: null, count: 0 };
  const row = data as { avg_rating: number | string | null; review_count: number };
  return {
    avg: row.avg_rating == null ? null : Number(row.avg_rating),
    count: Number(row.review_count ?? 0),
  };
}

export async function fetchMyReview(peakSlug: string): Promise<Review | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("peak_slug", peakSlug)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data as Review;
}

export interface ReviewInput {
  rating: number;
  body: string;
  conditions: string[];
  hikedOn: string | null;
}

/** Create or update the signed-in user's review for a mountain. */
export async function saveReview(peakSlug: string, input: ReviewInput): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to leave a review.");

  const row = {
    user_id: user.id,
    peak_slug: peakSlug,
    rating: input.rating,
    body: input.body.trim() || null,
    conditions: input.conditions.length ? input.conditions : null,
    hiked_on: input.hikedOn || null,
  };

  const { error } = await supabase
    .from("reviews")
    .upsert(row as never, { onConflict: "user_id,peak_slug" });

  if (error) {
    if (isMissingTable(error)) {
      throw new Error("Reviews aren't set up yet (run sql/peaks-first-schema.sql).");
    }
    throw error;
  }
}

export async function deleteReview(reviewId: number): Promise<void> {
  const { error } = await createClient().from("reviews").delete().eq("id", reviewId);
  if (error) throw error;
}

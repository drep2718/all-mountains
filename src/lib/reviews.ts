import { createClient } from "@/lib/supabase/client";

export interface Review {
  id: number;
  user_id: string;
  route_id: number | null;
  peak_id: number | null;
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

export type Subject = "route" | "peak";

/** Trail conditions a hiker can flag, mirroring what AllTrails collects. */
export const CONDITION_OPTIONS = [
  "Dry", "Muddy", "Snow", "Icy", "Overgrown",
  "Bugs", "Washed out", "Blowdown", "Scramble", "Busy",
] as const;

/**
 * The reviews table ships as a separate migration (sql/reviews.sql). Until it's
 * applied, PostgREST answers with a "relation does not exist" error. Treating
 * that as "no reviews yet" keeps trail pages fully working on a database that
 * hasn't run the migration, instead of showing an error for a missing feature.
 */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "42P01" || /does not exist/i.test(err.message ?? "");
}

const col = (s: Subject) => (s === "route" ? "route_id" : "peak_id");

export async function fetchReviews(subject: Subject, id: number): Promise<Review[]> {
  const { data, error } = await createClient()
    .from("reviews")
    .select("*")
    .eq(col(subject), id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as Review[];
}

export async function fetchRating(subject: Subject, id: number): Promise<RatingSummary> {
  const view = subject === "route" ? "route_ratings" : "peak_ratings";
  const { data, error } = await createClient()
    .from(view)
    .select("avg_rating,review_count")
    .eq(col(subject), id)
    .maybeSingle();
  if (error || !data) return { avg: null, count: 0 };
  const row = data as { avg_rating: number | string | null; review_count: number };
  return {
    avg: row.avg_rating == null ? null : Number(row.avg_rating),
    count: Number(row.review_count ?? 0),
  };
}

export async function fetchMyReview(subject: Subject, id: number): Promise<Review | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq(col(subject), id)
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

/** Create or update the signed-in user's review for a trail/peak. */
export async function saveReview(
  subject: Subject,
  id: number,
  input: ReviewInput
): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to leave a review.");

  const row = {
    user_id: user.id,
    [col(subject)]: id,
    rating: input.rating,
    body: input.body.trim() || null,
    conditions: input.conditions.length ? input.conditions : null,
    hiked_on: input.hikedOn || null,
  };

  const { error } = await supabase
    .from("reviews")
    .upsert(row as never, { onConflict: `user_id,${col(subject)}` });

  if (error) {
    if (isMissingTable(error)) {
      throw new Error("Reviews aren't set up on this database yet (run sql/reviews.sql).");
    }
    throw error;
  }
}

export async function deleteReview(reviewId: number): Promise<void> {
  const { error } = await createClient().from("reviews").delete().eq("id", reviewId);
  if (error) throw error;
}

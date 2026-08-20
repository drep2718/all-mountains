"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import StarRating from "./StarRating";
import {
  CONDITION_OPTIONS, deleteReview, fetchMyReview, fetchRating, fetchReviews,
  saveReview, type Subject,
} from "@/lib/reviews";

export default function Reviews({ subject, id }: { subject: Subject; id: number }) {
  const qc = useQueryClient();
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [conditions, setConditions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => setSignedIn(!!user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_e, s) => setSignedIn(!!s?.user)
    );
    return () => subscription.unsubscribe();
  }, []);

  const key = [subject, id] as const;
  const summary = useQuery({ queryKey: ["rating", ...key], queryFn: () => fetchRating(subject, id) });
  const list = useQuery({ queryKey: ["reviews", ...key], queryFn: () => fetchReviews(subject, id) });
  const mine = useQuery({
    queryKey: ["my-review", ...key],
    queryFn: () => fetchMyReview(subject, id),
    enabled: signedIn,
  });

  // Prefill the form from an existing review when the editor opens.
  const openEditor = useCallback(() => {
    const r = mine.data;
    setRating(r?.rating ?? 0);
    setBody(r?.body ?? "");
    setConditions(r?.conditions ?? []);
    setError(null);
    setOpen(true);
  }, [mine.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["rating", ...key] });
    qc.invalidateQueries({ queryKey: ["reviews", ...key] });
    qc.invalidateQueries({ queryKey: ["my-review", ...key] });
  };

  const save = useMutation({
    mutationFn: () =>
      saveReview(subject, id, { rating, body, conditions, hikedOn: null }),
    onSuccess: () => { setOpen(false); invalidate(); },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Couldn't save your review."),
  });

  const remove = useMutation({
    mutationFn: (reviewId: number) => deleteReview(reviewId),
    onSuccess: invalidate,
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Couldn't delete your review."),
  });

  const avg = summary.data?.avg ?? null;
  const count = summary.data?.count ?? 0;
  const reviews = list.data ?? [];

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display font-bold text-ink">Reviews</h3>
          {avg != null ? (
            <div className="mt-1 flex items-center gap-2">
              <StarRating value={avg} size="sm" />
              <span className="font-mono text-sm font-semibold text-ink">{avg.toFixed(1)}</span>
              <span className="text-sm text-ink-muted">
                ({count} review{count === 1 ? "" : "s"})
              </span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">No reviews yet — be the first.</p>
          )}
        </div>

        {signedIn ? (
          <button
            onClick={openEditor}
            className="rounded-xl bg-pine-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pine-700"
          >
            {mine.data ? "Edit your review" : "Write a review"}
          </button>
        ) : (
          <Link
            href="/login"
            className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-ground"
          >
            Sign in to review
          </Link>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-xl border border-diff-extreme/40 bg-diff-extreme/10 px-3 py-2 text-sm text-diff-extreme">
          {error}
        </p>
      )}

      {open && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (rating > 0) save.mutate(); }}
          className="mb-5 rounded-2xl border border-border bg-ground p-4"
        >
          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-ink">Your rating</label>
            <StarRating value={rating} onChange={setRating} size="lg" />
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-sm font-medium text-ink">Conditions</label>
            <div className="flex flex-wrap gap-1.5">
              {CONDITION_OPTIONS.map((c) => {
                const on = conditions.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() =>
                      setConditions((prev) =>
                        on ? prev.filter((x) => x !== c) : [...prev, c]
                      )
                    }
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      on
                        ? "border-pine-600 bg-pine-600/10 text-pine-700"
                        : "border-border bg-surface text-ink-muted hover:text-ink"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="How was it? Trail condition, parking, water, anything useful."
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-pine-600"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={rating === 0 || save.isPending}
              className="rounded-xl bg-pine-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pine-700 disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Post review"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-ink-muted"
            >
              Cancel
            </button>
            {mine.data && (
              <button
                type="button"
                onClick={() => { remove.mutate(mine.data!.id); setOpen(false); }}
                className="ml-auto rounded-xl px-3 py-2 text-sm font-semibold text-ink-faint transition-colors hover:text-diff-extreme"
              >
                Delete
              </button>
            )}
          </div>
          {rating === 0 && (
            <p className="mt-2 text-xs text-ink-faint">Pick a star rating to post.</p>
          )}
        </form>
      )}

      {reviews.length > 0 && (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li key={r.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
              <div className="flex items-center gap-2">
                <StarRating value={r.rating} size="sm" />
                <span className="text-xs text-ink-faint">
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
              {r.conditions?.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.conditions.map((c) => (
                    <span key={c} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-muted">
                      {c}
                    </span>
                  ))}
                </div>
              ) : null}
              {r.body && <p className="mt-1.5 text-sm text-ink">{r.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

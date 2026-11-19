"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Peak, PeakRoute, SummitLog } from "@/lib/peak-types";

/**
 * Log a summit from the peak page.
 *
 * Deliberately short: date and a tap. Everything else is optional, because a
 * form that asks ten questions gets filled in zero times, and the whole point
 * of the personal map is that marking a mountain is effortless.
 */
export default function LogSummitPanel({
  peak,
  routes,
}: {
  peak: Peak;
  routes: PeakRoute[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [allMine, setMine] = useState<SummitLog[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [routeId, setRouteId] = useState<string>("");
  const [rating, setRating] = useState(0);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    // One-shot getUser misses a session still hydrating, which is how the
    // lists page used to bounce signed-in users to the login screen.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUserId(session?.user?.id ?? null)
    );
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)).catch(() => setUserId(null));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const { data } = await supabase
          .from("summit_logs")
          .select("*")
          .eq("peak_slug", peak.slug)
          .eq("user_id", userId)
          .order("summited_at", { ascending: false });
        setMine((data ?? []) as SummitLog[]);
      } catch {
        setMine([]);
      }
    })();
  }, [userId, peak.slug, supabase]);

  // Gated rather than cleared, so signing out doesn't setState in an effect.
  const mine = userId ? allMine : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    setSaving(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("summit_logs")
      .insert({
        user_id: userId,
        peak_slug: peak.slug,
        summited_at: date,
        route_id: routeId ? Number(routeId) : null,
        rating: rating || null,
        notes: notes.trim() || null,
        is_public: true,
      })
      .select()
      .single();

    setSaving(false);
    // Surface the failure. Swallowing it is why lists "didn't work" before.
    if (err) {
      setError(err.message);
      return;
    }
    setMine((m) => [data as SummitLog, ...m]);
    setOpen(false);
    setNotes("");
    setRating(0);
  }

  if (!userId) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 text-sm">
        <span className="text-ink-muted">Sign in to log this summit and put it on your map. </span>
        <Link href="/login" className="font-medium text-pine-600 hover:underline">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-ink">
            {mine.length ? "You've summited this" : "Been to the top?"}
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {mine.length
              ? `${mine.length} ascent${mine.length === 1 ? "" : "s"} · most recent ${new Date(
                  mine[0].summited_at + "T12:00:00"
                ).toLocaleDateString()}`
              : "Logging it marks the mountain on your summit map."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 rounded-lg bg-pine-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-pine-500"
        >
          {open ? "Cancel" : mine.length ? "Log again" : "Log summit"}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-ink-faint">Date</span>
              <input
                type="date"
                value={date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-border bg-ground px-3 py-2 text-sm text-ink"
              />
            </label>

            {routes.length > 0 && (
              <label className="block">
                <span className="text-xs text-ink-faint">Route (optional)</span>
                <select
                  value={routeId}
                  onChange={(e) => setRouteId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-ground px-3 py-2 text-sm text-ink"
                >
                  <option value="">—</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name ?? `Unnamed path (${r.distance_km?.toFixed(1)} km)`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div>
            <span className="text-xs text-ink-faint">Rating (optional)</span>
            <div className="mt-1 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  onClick={() => setRating(n === rating ? 0 : n)}
                  className={`text-2xl leading-none transition ${
                    n <= rating ? "text-amber-600" : "text-ink-faint hover:text-amber-600/50"
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-xs text-ink-faint">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Conditions, who you went with, what the view did."
              className="mt-1 w-full resize-y rounded-lg border border-border bg-ground px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
            />
          </label>

          {error && <p className="text-xs text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-pine-600 py-2.5 text-sm font-semibold text-white transition hover:bg-pine-500 disabled:opacity-60"
          >
            {saving ? "Saving…" : `Mark ${peak.name} as summited`}
          </button>
        </form>
      )}
    </div>
  );
}

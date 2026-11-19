"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { SummitLog } from "@/lib/peak-types";
import type { MapPeak } from "@/components/SummitMap";

// Mapbox GL touches `window` at import time.
const SummitMap = dynamic(() => import("@/components/SummitMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-surface" />,
});

/**
 * Your mountains.
 *
 * The old logbook was a list, which answers "what have I done" but not "where
 * have I been" or "what's left" — the two questions that make bagging
 * addictive. Progress is measured against the catalogue, so the denominator
 * is real.
 */
export default function LogbookPage() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [peaks, setPeaks] = useState<MapPeak[]>([]);
  const [logs, setLogs] = useState<SummitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<"map" | "list">("map");

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
      setChecked(true);
    });
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null))
      .catch(() => setUserId(null))
      .finally(() => setChecked(true));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  // The whole catalogue, for the map and for the denominator. ~1,000 rows of
  // six small columns is well under a hundred kilobytes.
  //
  // The .catch is not optional. A Supabase query REJECTS when the network is
  // gone — it does not resolve with an empty result — so a bare .then leaves
  // `loading` true forever and the page spins with no explanation. That exact
  // bug shipped on the trail page once already.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // PostgREST caps a response at 1,000 rows regardless of .limit(),
        // so a single call silently returned 1,000 of 1,032 — the map lost 32
        // mountains and the denominator read "of 1,000". Page until short.
        const PAGE = 1000;
        const all: MapPeak[] = [];
        let error: { message: string } | null = null;
        for (let from = 0; ; from += PAGE) {
          const res = await supabase
            .from("peaks")
            .select("slug,name,elevation_m,latitude,longitude,country,category")
            .order("elevation_m", { ascending: false })
            .range(from, from + PAGE - 1);
          if (res.error) {
            error = res.error;
            break;
          }
          const rows = (res.data ?? []) as MapPeak[];
          all.push(...rows);
          if (rows.length < PAGE) break;
          if (cancelled) return;
        }
        const data = all;
        if (cancelled) return;
        // Supabase reports a dead host as a resolved result carrying an
        // `error`, not a rejection. Reading only `data` turns "couldn't reach
        // the catalogue" into "the catalogue is empty" — the page would claim
        // 0 of 0 summits instead of admitting it has no idea.
        if (error) setFailed(true);
        else setPeaks(data);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        // Must run on every path. A query that rejects and leaves `loading`
        // true is how the trail page once span forever offline.
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    // No clearing branch: when there is no user there is nothing to fetch, and
    // `logs` is already gated on userId below.
    if (!userId) return;
    (async () => {
      try {
        const { data } = await supabase
          .from("summit_logs")
          .select("*")
          .eq("user_id", userId)
          .order("summited_at", { ascending: false });
        setLogs((data ?? []) as SummitLog[]);
      } catch {
        setLogs([]);
      }
    })();
  }, [userId, supabase]);

  // Gate on userId rather than clearing state when the user signs out.
  const visibleLogs = useMemo(() => (userId ? logs : []), [userId, logs]);
  const summited = useMemo(
    () => new Set(visibleLogs.map((l) => l.peak_slug)),
    [visibleLogs]
  );
  const bySlug = useMemo(() => new Map(peaks.map((p) => [p.slug, p])), [peaks]);

  const stats = useMemo(() => {
    const done = [...summited].map((s) => bySlug.get(s)).filter(Boolean) as MapPeak[];
    const highpoints = peaks.filter((p) => p.category === "highpoint");
    return {
      summited: done.length,
      total: peaks.length,
      ascents: visibleLogs.length,
      countries: new Set(done.map((p) => p.country)).size,
      totalCountries: new Set(peaks.map((p) => p.country)).size,
      highpoints: done.filter((p) => p.category === "highpoint").length,
      totalHighpoints: highpoints.length,
      vertical: done.reduce((s, p) => s + p.elevation_m, 0),
      highest: done.reduce<MapPeak | null>(
        (a, p) => (!a || p.elevation_m > a.elevation_m ? p : a),
        null
      ),
    };
  }, [summited, bySlug, peaks, visibleLogs]);

  if (!checked || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-pine-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Your mountains</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {failed
              ? "Catalogue unavailable"
              : userId
                ? `${stats.summited} of ${stats.total.toLocaleString()} summits in the catalogue`
                : "Sign in to start marking the ones you've climbed"}
          </p>
        </div>
        <div className="flex rounded-lg border border-border p-0.5">
          {(["map", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1.5 text-sm capitalize transition ${
                view === v ? "bg-pine-600 text-white" : "text-ink-muted hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {failed && (
        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Couldn&apos;t reach the catalogue. Your logged summits are safe — this is a
          connection problem, not lost data.
        </div>
      )}

      {!userId && (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-4 text-sm">
          <span className="text-ink-muted">Your summit map is tied to your account. </span>
          <Link href="/login" className="font-medium text-pine-600 hover:underline">
            Sign in
          </Link>
        </div>
      )}

      {/* Progress */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Summits" value={`${stats.summited}`} sub={`of ${stats.total.toLocaleString()}`} />
        <Stat
          label="Highpoints"
          value={`${stats.highpoints}`}
          sub={`of ${stats.totalHighpoints}`}
        />
        <Stat
          label="Countries"
          value={`${stats.countries}`}
          sub={`of ${stats.totalCountries}`}
        />
        <Stat
          label="Vertical"
          value={`${(stats.vertical / 1000).toFixed(1)} km`}
          sub={stats.highest ? `highest ${stats.highest.name}` : "—"}
        />
      </div>

      {stats.total > 0 && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full rounded-full bg-[#e8b33a] transition-all"
            style={{ width: `${Math.max(0.5, (100 * stats.summited) / stats.total)}%` }}
          />
        </div>
      )}

      {view === "map" ? (
        <div className="mt-5 h-[60vh] min-h-[380px] overflow-hidden rounded-2xl border border-border">
          <SummitMap peaks={peaks} summited={summited} />
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {visibleLogs.length === 0 ? (
            <EmptyState signedIn={!!userId} />
          ) : (
            visibleLogs.map((log) => {
              const p = bySlug.get(log.peak_slug);
              return (
                <Link
                  key={log.id}
                  href={`/peaks/${log.peak_slug}`}
                  className="flex items-center gap-4 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-bright"
                >
                  <span className="text-2xl">⛰</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink">
                      {p?.name ?? log.peak_slug}
                    </div>
                    <div className="mt-0.5 text-sm text-ink-muted">
                      {new Date(log.summited_at + "T12:00:00").toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                      {p ? ` · ${p.elevation_m.toLocaleString()} m · ${p.country}` : ""}
                    </div>
                    {log.notes && (
                      <p className="mt-1 truncate text-sm text-ink-faint">{log.notes}</p>
                    )}
                  </div>
                  {log.rating ? (
                    <span className="shrink-0 text-sm text-amber-600">
                      {"★".repeat(log.rating)}
                    </span>
                  ) : null}
                </Link>
              );
            })
          )}
        </div>
      )}

      {view === "map" && userId && stats.summited === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">
          Nothing marked yet. Open any peak and tap <strong className="text-ink">Log summit</strong> —
          it&apos;ll turn gold here.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-[11px] text-ink-faint">{label}</div>
      <div className="mt-0.5 font-display text-2xl font-bold text-ink">{value}</div>
      <div className="truncate text-[11px] text-ink-faint" title={sub}>
        {sub}
      </div>
    </div>
  );
}

function EmptyState({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-border py-16 text-center">
      <span className="text-5xl">📔</span>
      <p className="mt-4 text-ink-muted">
        {signedIn ? "No summits logged yet" : "Sign in to start your logbook"}
      </p>
      <Link
        href="/peaks"
        className="mt-5 inline-block rounded-lg bg-pine-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-pine-500"
      >
        Browse peaks
      </Link>
    </div>
  );
}

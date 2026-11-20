"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  accessInfo,
  formatDistance,
  formatDuration,
  formatEstimate,
  type Peak,
  type PeakRoute,
} from "@/lib/peak-types";
import { describeSummitGap } from "@/lib/summit-gap";
import { tripFigures } from "@/lib/trip";
import { routeStaticMapUrl } from "@/lib/staticMap";
import ElevationProfile from "@/components/ElevationProfile";
import SaveToListButton from "@/components/SaveToListButton";
import TrailheadActions from "@/components/TrailheadActions";
import Reviews from "@/components/Reviews";

/**
 * One route up one mountain.
 *
 * Simpler than it was: a route belongs to a peak, so there is no "peaks along
 * this trail" list to assemble from a join table, and the route's country and
 * region come from the mountain rather than being duplicated onto every row.
 */
export default function RouteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [route, setRoute] = useState<PeakRoute | null>(null);
  const [peak, setPeak] = useState<Peak | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState("loading");
      setPeak(null);
      try {
        const routeId = Number(id);
        if (!Number.isSafeInteger(routeId) || routeId <= 0) { setState("missing"); return; }
        const { data, error } = await supabase.from("routes").select("*").eq("id", routeId).maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        if (!data) { setState("missing"); return; }
        const r = data as PeakRoute;
        const { data: p, error: peakError } = await supabase.from("peaks").select("*").eq("slug", r.peak_slug).single();
        if (peakError) throw peakError;
        if (cancelled) return;
        setRoute(r);
        setPeak(p as Peak);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, supabase, attempt]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-pine-600" />
      </div>
    );
  }

  if (state === "error") return (
    <div role="alert" className="mx-auto max-w-xl px-4 py-24 text-center text-ink">
      <p>Couldn’t load this route. Check your connection and try again.</p>
      <button onClick={() => setAttempt((n) => n + 1)} className="mt-4 font-semibold text-pine-600 underline">Retry</button>
    </div>
  );

  if (state === "missing" || !route) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <p className="text-5xl">🥾</p>
        <h1 className="mt-4 font-display text-xl font-bold text-ink">Route not found</h1>
        <Link href="/peaks" className="mt-6 inline-block text-sm text-pine-600 hover:underline">
          Browse peaks
        </Link>
      </div>
    );
  }

  const access = accessInfo(route);
  const mapUrl = routeStaticMapUrl(route, 1200, 500);

  const summitGap = describeSummitGap({
    isSummitRoute: route.is_summit_route,
    distanceToSummitM: route.distance_to_summit_m,
    highPointM: route.high_point_m,
    summitElevationM: peak?.elevation_m ?? null,
  });

  // The whole trip, not the one-way line the geometry stores — the stored
  // columns describe the climb alone. See `tripFigures`.
  const trip = tripFigures({
    routeType: route.route_type,
    distanceKm: route.distance_km,
    ascentM: route.ascent_m,
    descentM: route.descent_m,
    storedMinutes: route.est_time_min,
    difficulty: (peak?.difficulty ?? "hike") as "hike" | "scramble" | "technical",
  });

  const stats = [
    {
      label: trip.roundTrip ? "Round trip" : "Distance",
      value: formatDistance(trip.distanceKm),
    },
    // Listed separately rather than tucked into a tooltip: the one-way
    // figure is the climb, and it is what a turnaround time is set against.
    ...(trip.roundTrip && trip.oneWayKm != null
      ? [{ label: "One way", value: formatDistance(trip.oneWayKm) }]
      : []),
    { label: "Est. time", value: formatEstimate(trip.minutes) },
    { label: "Ascent", value: trip.ascentM != null ? `${trip.ascentM.toLocaleString()} m` : "—" },
    { label: "Type", value: route.route_type ?? "—" },
    { label: "Difficulty", value: route.difficulty ?? "—" },
    { label: "Surface", value: route.surface ?? "—" },
    {
      // "287 m short" was measured in plan view, so a route that ends 830 m
      // beneath the summit could read as nearly there. Height first.
      label: "To summit",
      value: route.is_summit_route ? "Reaches the top" : (summitGap?.label ?? "—"),
      title: summitGap?.detail,
    },
    { label: "Ref", value: route.ref ?? "—" },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 pb-24">
      <button
        onClick={() => router.back()}
        className="mb-4 flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        ← Back
      </button>

      {mapUrl && (
        <img
          src={mapUrl}
          alt={`Map of ${route.name ?? "the route"}`}
          className="h-56 w-full rounded-2xl object-cover sm:h-72"
        />
      )}

      <h1 className="mt-5 font-display text-2xl font-bold text-ink sm:text-3xl">
        {route.name ?? "Unnamed path"}
      </h1>
      {peak && (
        <p className="mt-1 text-ink-muted">
          up{" "}
          <Link href={`/peaks/${peak.slug}`} className="text-pine-600 hover:underline">
            {peak.name}
          </Link>
          {" · "}
          {[peak.range_name, peak.country].filter(Boolean).join(" · ")}
        </p>
      )}

      <div className="mt-5 space-y-3">
        <Link
          href={`/record?peak=${route.peak_slug}&route=${route.id}`}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-pine-600 py-3.5 text-sm font-bold text-white transition-colors hover:bg-pine-700"
        >
          ▶ Navigate this route
        </Link>
        {/* A route belongs to a mountain, so saving it saves the mountain. */}
        <SaveToListButton peakSlug={route.peak_slug} />
        {peak && (
          <Link
            href={`/peaks/${peak.slug}`}
            className="block rounded-2xl border border-border py-3 text-center text-sm text-ink-muted transition hover:bg-ground/40"
          >
            Download {peak.name} for offline use →
          </Link>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface p-3" title={s.title}>
            <div className="text-[11px] text-ink-faint">{s.label}</div>
            {/* Wraps rather than truncates: "stops 2,065 m below the top"
                is longer than a tile and losing the end of it would leave
                "stops 2,065 m below the…", which says nothing useful. */}
            <div className="mt-0.5 font-mono text-sm font-semibold leading-snug text-ink">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {access.length > 0 && (
        <p className="mt-4 text-sm text-ink-muted">{access.join(" · ")}</p>
      )}

      <div className="mt-6">
        <ElevationProfile
          geometry={route.poly}
          ascentM={route.ascent_m}
          descentM={route.descent_m}
          distanceKm={route.distance_km}
        />
      </div>

      <div className="mt-6">
        <TrailheadActions route={route} />
      </div>

      {route.description && (
        <section className="mt-6 rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-2 font-display text-lg font-bold text-ink">About this route</h2>
          <p className="text-sm leading-relaxed text-ink-muted">{route.description}</p>
        </section>
      )}

      <div className="mt-6">
        <Reviews peakSlug={route.peak_slug} />
      </div>
    </div>
  );
}

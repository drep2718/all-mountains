"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  accessInfo,
  formatDistance,
  formatDuration,
  type Peak,
  type PeakRoute,
} from "@/lib/peak-types";
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
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("routes")
        .select("*")
        .eq("id", Number(id))
        .single();

      if (cancelled) return;
      if (error || !data) {
        setState("missing");
        return;
      }
      const r = data as PeakRoute;
      setRoute(r);
      setState("ready");

      const { data: p } = await supabase
        .from("peaks")
        .select("*")
        .eq("slug", r.peak_slug)
        .single();
      if (!cancelled && p) setPeak(p as Peak);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, supabase]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-pine-600" />
      </div>
    );
  }

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

  const stats = [
    { label: "Distance", value: formatDistance(route.distance_km) },
    { label: "Time", value: formatDuration(route.est_time_min) },
    { label: "Ascent", value: route.ascent_m != null ? `${route.ascent_m.toLocaleString()} m` : "—" },
    { label: "Type", value: route.route_type ?? "—" },
    { label: "Difficulty", value: route.difficulty ?? "—" },
    { label: "Surface", value: route.surface ?? "—" },
    {
      label: "To summit",
      value: route.is_summit_route
        ? "Reaches the top"
        : route.distance_to_summit_m != null
          ? `${route.distance_to_summit_m} m short`
          : "—",
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
          <div key={s.label} className="rounded-xl border border-border bg-surface p-3">
            <div className="text-[11px] text-ink-faint">{s.label}</div>
            <div className="mt-0.5 truncate font-mono text-sm font-semibold text-ink">
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

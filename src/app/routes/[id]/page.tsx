"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Route, Peak } from "@/lib/types";
import {
  getDifficulty, getDifficultyColor, formatDuration,
  NETWORK_LABEL, surfaceLabel, accessInfo,
} from "@/lib/types";
import { routeStaticMapUrl } from "@/lib/staticMap";
import SaveToListButton from "@/components/SaveToListButton";
import DownloadTrailButton from "@/components/DownloadTrailButton";
import ElevationProfile from "@/components/ElevationProfile";
import TrailheadActions from "@/components/TrailheadActions";
import Reviews from "@/components/Reviews";
import { getDownload } from "@/lib/offline";

export default function RouteDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [route, setRoute] = useState<Route | null>(null);
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      // With no signal these calls reject rather than resolving empty, so each
      // is guarded independently: a failed fetch must still end in a rendered
      // page, not a spinner that never stops.
      let fetched: Route | null = null;
      try {
        const { data } = await supabase.from("routes").select("*").eq("id", id).single();
        if (data) fetched = data as Route;
      } catch {
        /* offline — fall back to the downloaded copy below */
      }

      if (!fetched) {
        // If this trail was downloaded, its full record is on the device. That
        // is the entire point of downloading it, so use it rather than showing
        // "not found" to someone standing at the trailhead.
        const saved = getDownload(Number(id));
        if (saved?.payload) fetched = saved.payload as Route;
      }
      setRoute(fetched);

      try {
        const { data: rp } = await supabase
          .from("route_peaks").select("peaks(*)").eq("route_id", id);
        if (rp) {
          const ps = (rp as unknown as { peaks: Peak }[]).map((row) => row.peaks).filter(Boolean);
          ps.sort((a, b) => (b.elevation || 0) - (a.elevation || 0));
          setPeaks(ps);
        }
      } catch {
        /* peaks list is enrichment; the trail itself still renders */
      }

      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-trail-500" />
      </div>
    );
  }
  if (!route) {
    return <div className="flex min-h-screen items-center justify-center text-ink-muted">Route not found.</div>;
  }

  const mapUrl = routeStaticMapUrl(route, 800, 420);
  const tags = route.tags || {};
  const access = accessInfo(tags);
  const surface = surfaceLabel(tags.surface);

  const stats = [
    { label: "Length", value: route.distance_km != null ? `${route.distance_km.toFixed(1)} km` : "—" },
    { label: "Est. time", value: formatDuration(route.est_time_min) },
    { label: "Elevation gain", value: route.ascent_m != null ? `${route.ascent_m.toLocaleString()} m` : "—" },
    { label: "Route type", value: route.route_type || "—" },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <button onClick={() => router.back()} className="mb-4 flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-ink">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>

      {/* Hero: the actual route drawn on a map — tap to open it on the live map */}
      <Link href={`/explore?route=${route.id}`}
        className="group relative block overflow-hidden rounded-3xl border border-border bg-surface-2">
        {mapUrl && (
          <img src={mapUrl} alt={`Map of ${route.name}`} className="h-56 w-full object-cover sm:h-72" />
        )}
        <div className="absolute inset-0 flex items-end justify-end p-3 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="rounded-full bg-ground/90 px-3 py-1.5 text-xs font-semibold text-ink backdrop-blur">
            Open on map →
          </span>
        </div>
        <span className="absolute bottom-3 left-3 rounded-full bg-ground/90 px-3 py-1.5 text-xs font-medium text-ink backdrop-blur sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
          Tap to view route on map
        </span>
      </Link>

      <div className="mt-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-trail-500/15 px-3 py-1 text-xs font-semibold text-trail-500">🥾 Hiking Route</span>
          {route.difficulty && (
            <span className="rounded-full bg-trail-500/15 px-3 py-1 text-xs font-semibold text-trail-500">{route.difficulty}</span>
          )}
          {route.route_type && (
            <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-ink-muted">{route.route_type}</span>
          )}
          {route.network && NETWORK_LABEL[route.network] && (
            <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-ink-muted">{NETWORK_LABEL[route.network]}</span>
          )}
        </div>
        <h1 className="mt-3 font-display text-3xl font-extrabold text-ink sm:text-4xl">{route.name || "Unnamed Route"}</h1>
        <p className="mt-1 text-ink-muted">{route.region ? `${route.region}, ` : ""}{route.country}</p>
      </div>

      {/* Take-it-with-you actions: record, save, download for offline */}
      <div className="mt-5 space-y-3">
        <Link
          href={`/record?route=${route.id}`}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-pine-600 py-3.5 text-sm font-bold text-white transition-colors hover:bg-pine-700"
        >
          ▶ Record this hike
        </Link>
        <SaveToListButton itemType="route" itemId={route.id} />
        <DownloadTrailButton route={route} />
      </div>

      {/* Key stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-surface p-4">
            <div className="text-xs text-ink-faint">{s.label}</div>
            <div className="mt-1 font-mono text-lg font-semibold text-ink">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Getting to the trailhead */}
      <div className="mt-4">
        <TrailheadActions route={route} />
      </div>

      {/* Elevation profile */}
      <div className="mt-4">
        <ElevationProfile
          geometry={route.geometry}
          ascentM={route.ascent_m}
          descentM={route.descent_m}
          distanceKm={route.distance_km}
        />
      </div>

      {/* Details grid — access, surface, descent, peaks */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="mb-3 font-display font-bold text-ink">Trail details</h3>
          <dl className="space-y-2 text-sm">
            {surface && <Row label="Surface" value={surface} />}
            {route.descent_m != null && <Row label="Descent" value={`${route.descent_m.toLocaleString()} m`} />}
            <Row label="Peaks crossed" value={peaks.length.toString()} />
            {tags.operator && <Row label="Maintained by" value={tags.operator} />}
            {tags.ref && <Row label="Trail ref" value={tags.ref} />}
          </dl>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="mb-3 font-display font-bold text-ink">Access</h3>
          {access.length > 0 ? (
            <ul className="space-y-1.5 text-sm text-ink-muted">
              {access.map((a) => (
                <li key={a} className="flex items-center gap-2">
                  <span className="text-pine-600">✓</span> {a}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-faint">No access info recorded for this trail.</p>
          )}
        </div>
      </div>

      {route.description && (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-5">
          <h3 className="mb-2 font-display font-bold text-ink">About</h3>
          <p className="text-sm leading-relaxed text-ink-muted">{route.description}</p>
        </div>
      )}

      {/* Ratings, conditions, and written reviews */}
      <div className="mt-4">
        <Reviews subject="route" id={route.id} />
      </div>

      {/* Peaks along the route */}
      <h2 className="mt-8 mb-3 font-display text-xl font-bold text-ink">
        Peaks along this trail {peaks.length > 0 && <span className="text-ink-faint">({peaks.length})</span>}
      </h2>
      {peaks.length === 0 ? (
        <p className="text-sm text-ink-faint">No catalogued peaks directly on this trail.</p>
      ) : (
        <div className="space-y-2">
          {peaks.map((peak) => {
            const diff = getDifficulty(peak.elevation);
            return (
              <Link key={peak.id} href={`/peaks/${peak.id}`}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-colors hover:border-border-bright">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg opacity-70">⛰</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display font-semibold text-ink">{peak.name || "Unnamed Peak"}</div>
                  <div className="text-sm text-ink-muted">{peak.country}</div>
                </div>
                {peak.elevation && <span className="font-mono text-sm font-medium text-pine-600">{peak.elevation.toLocaleString()}m</span>}
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getDifficultyColor(diff)}`}>{diff}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

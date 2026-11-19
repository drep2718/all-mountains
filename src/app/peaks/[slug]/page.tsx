"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  CATEGORY_LABEL,
  DIFFICULTY_LABEL,
  accessInfo,
  difficultyClasses,
  formatDistance,
  formatDuration,
  formatElevation,
  noRoutesMessage,
  type Peak,
  type PeakPhoto,
  type PeakRoute,
  type SummitLog,
} from "@/lib/peak-types";
import { getPeakDownload } from "@/lib/offline";
import PeakGallery from "@/components/PeakGallery";
import PeakWeather from "@/components/PeakWeather";
import DownloadPeakButton from "@/components/DownloadPeakButton";
import LogSummitPanel from "@/components/LogSummitPanel";
import Reviews from "@/components/Reviews";

interface Bundle {
  peak: Peak;
  photos: PeakPhoto[];
  routes: PeakRoute[];
}

export default function PeakPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [data, setData] = useState<Bundle | null>(null);
  const [nearby, setNearby] = useState<Peak[]>([]);
  const [logs, setLogs] = useState<SummitLog[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [rank, setRank] = useState<{ place: number; of: number } | null>(null);
  const [fromCache, setFromCache] = useState(false);

  // Offline bundle first, network second. If this inverts, the one screen that
  // has to work on a mountain stops working on a mountain.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = getPeakDownload(slug);
      const payload = cached?.payload as Bundle | undefined;
      if (payload?.peak) {
        if (!cancelled) {
          setData(payload);
          setState("ready");
          setFromCache(true);
        }
      }

      try {
        const { data: peak, error } = await supabase
          .from("peaks")
          .select("*")
          .eq("slug", slug)
          .single();
        if (error || !peak) throw error ?? new Error("not found");

        const [{ data: photos }, { data: routes }] = await Promise.all([
          supabase.from("peak_photos").select("*").eq("peak_slug", slug).order("sort_order"),
          supabase
            .from("routes")
            .select("*")
            .eq("peak_slug", slug)
            .order("is_summit_route", { ascending: false })
            .order("distance_to_summit_m"),
        ]);

        if (cancelled) return;
        setData({
          peak: peak as Peak,
          photos: (photos ?? []) as PeakPhoto[],
          routes: (routes ?? []) as PeakRoute[],
        });
        setState("ready");
        setFromCache(false);
      } catch {
        // A rejected query offline must not leave the page spinning forever —
        // that bug shipped once already.
        if (!cancelled && !payload) setState("missing");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, supabase]);

  // Secondary data: never blocks the page, never needed offline.
  useEffect(() => {
    if (!data?.peak || fromCache) return;
    const p = data.peak;
    const dLat = 0.65;
    const dLng = dLat / Math.max(Math.cos((p.latitude * Math.PI) / 180), 0.1);

    // Secondary data. Wrapped so a failure can never block the page or leak
    // an unhandled rejection; both lists simply stay empty.
    (async () => {
      try {
        const { data } = await supabase
          .from("peaks")
          .select("slug,name,elevation_m,latitude,longitude,country,difficulty,category,hero_photo_url")
          .gte("latitude", p.latitude - dLat)
          .lte("latitude", p.latitude + dLat)
          .gte("longitude", p.longitude - dLng)
          .lte("longitude", p.longitude + dLng)
          .neq("slug", p.slug)
          .order("elevation_m", { ascending: false })
          .limit(6);
        setNearby((data ?? []) as Peak[]);
      } catch {
        setNearby([]);
      }
    })();

    // Rank within its country, counted from our own catalogue. Replaces the
    // "isolation" figure from Wikidata, whose units are unreliable per-record
    // (Denali is recorded as 7.4 km isolated; the real figure is 7,450 km —
    // the magnitude is right but the claim is tagged metres, not kilometres).
    (async () => {
      try {
        const [higher, total] = await Promise.all([
          supabase
            .from("peaks")
            .select("slug", { count: "exact", head: true })
            .eq("country", p.country)
            .gt("elevation_m", p.elevation_m),
          supabase
            .from("peaks")
            .select("slug", { count: "exact", head: true })
            .eq("country", p.country),
        ]);
        if (higher.count != null && total.count != null) {
          setRank({ place: higher.count + 1, of: total.count });
        }
      } catch {
        setRank(null);
      }
    })();

    (async () => {
      try {
        const { data } = await supabase
          .from("summit_logs")
          .select("*")
          .eq("peak_slug", p.slug)
          .eq("is_public", true)
          .order("summited_at", { ascending: false })
          .limit(10);
        setLogs((data ?? []) as SummitLog[]);
      } catch {
        setLogs([]);
      }
    })();
  }, [data?.peak, fromCache, supabase]);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-pine-600" />
      </div>
    );
  }

  if (state === "missing" || !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <p className="text-5xl">⛰</p>
        <h1 className="mt-4 font-display text-xl font-bold text-ink">Peak not found</h1>
        <p className="mt-2 text-sm text-ink-muted">
          It may not be in the catalogue, or you may be offline and it isn&apos;t downloaded.
        </p>
        <Link
          href="/downloads"
          className="mt-6 inline-block rounded-lg border border-border px-4 py-2 text-sm text-ink-muted hover:bg-ground/40"
        >
          See your downloads
        </Link>
      </div>
    );
  }

  const { peak, photos, routes } = data;
  const summitRoutes = routes.filter((r) => r.is_summit_route);
  const approachRoutes = routes.filter((r) => !r.is_summit_route);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 pb-24">
      <button
        onClick={() => router.back()}
        className="mb-4 flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>

      {fromCache && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Showing your downloaded copy.
        </p>
      )}

      <PeakGallery peak={peak} photos={photos} />

      {/* Title */}
      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${difficultyClasses(peak.difficulty)}`}
          >
            {DIFFICULTY_LABEL[peak.difficulty]}
          </span>
          {peak.category === "highpoint" && (
            <span className="rounded-full bg-[#e8b33a] px-2.5 py-1 text-xs font-bold text-[#3d2c00]">
              🥇 {peak.region ? `${peak.region} highpoint` : "Highpoint"}
            </span>
          )}
          {peak.category === "top_peak" && (
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-900 ring-1 ring-violet-300">
              {CATEGORY_LABEL.top_peak}
            </span>
          )}
        </div>
        <h1 className="font-display text-3xl font-bold text-ink sm:text-4xl">{peak.name}</h1>
        <p className="mt-1 text-ink-muted">
          {[peak.range_name, peak.region, peak.country].filter(Boolean).join(" · ")}
        </p>
      </div>

      {/* Stats */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Elevation", value: `${peak.elevation_m.toLocaleString()} m` },
          { label: "In feet", value: `${Math.round(peak.elevation_m * 3.28084).toLocaleString()} ft` },
          {
            label: "Prominence",
            value: peak.prominence_m ? `${peak.prominence_m.toLocaleString()} m` : "—",
          },
          {
            label: `Rank in ${peak.country.length > 12 ? "country" : peak.country}`,
            value: rank ? `#${rank.place} of ${rank.of}` : "—",
          },
          { label: "Range", value: peak.range_name ?? "—" },
          { label: "Routes", value: routes.length ? String(routes.length) : "—" },
          { label: "Summited by", value: peak.summit_count ? String(peak.summit_count) : "—" },
          {
            label: "Coordinates",
            value: `${peak.latitude.toFixed(3)}, ${peak.longitude.toFixed(3)}`,
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface p-3">
            <div className="text-[11px] text-ink-faint">{s.label}</div>
            <div className="mt-0.5 truncate font-mono text-sm font-semibold text-ink" title={s.value}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        <DownloadPeakButton peak={peak} routes={routes} photos={photos} />
        <LogSummitPanel peak={peak} routes={routes} />
      </div>

      {/* Routes */}
      <section className="mt-6">
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          Routes to the summit
          {routes.length > 0 && (
            <span className="ml-2 text-sm font-normal text-ink-faint">{routes.length}</span>
          )}
        </h2>

        {routes.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-ink-muted">
            {noRoutesMessage(peak)}
          </p>
        ) : (
          <div className="space-y-2">
            {[...summitRoutes, ...approachRoutes].map((r) => (
              <RouteRow key={r.id} route={r} peakSlug={peak.slug} />
            ))}
          </div>
        )}
      </section>

      <div className="mt-6">
        <PeakWeather
          latitude={peak.latitude}
          longitude={peak.longitude}
          elevationM={peak.elevation_m}
        />
      </div>

      {/* About */}
      {peak.summary && (
        <section className="mt-6 rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-2 font-display text-lg font-bold text-ink">About {peak.name}</h2>
          <p className="text-sm leading-relaxed text-ink-muted">{peak.summary}</p>
          {peak.wikipedia_url && (
            <a
              href={peak.wikipedia_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-sm text-pine-600 hover:underline"
            >
              Read on Wikipedia
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          )}
        </section>
      )}

      {/* Who's been up */}
      {logs.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 font-display text-lg font-bold text-ink">Recent summits</h2>
          <div className="space-y-2">
            {logs.map((l) => (
              <div key={l.id} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink">
                    {new Date(l.summited_at + "T12:00:00").toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  {l.rating ? <span className="text-amber-600">{"★".repeat(l.rating)}</span> : null}
                </div>
                {l.notes && <p className="mt-1 text-sm text-ink-muted">{l.notes}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-6">
        <Reviews peakSlug={peak.slug} />
      </div>

      {/* Nearby */}
      {nearby.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-lg font-bold text-ink">Nearby summits</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {nearby.map((n) => (
              <Link
                key={n.slug}
                href={`/peaks/${n.slug}`}
                className="rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-bright"
              >
                <div className="truncate text-sm font-semibold text-ink">{n.name}</div>
                <div className="mt-0.5 font-mono text-xs text-ink-faint">
                  {n.elevation_m.toLocaleString()} m
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RouteRow({ route, peakSlug }: { route: PeakRoute; peakSlug: string }) {
  const access = accessInfo(route);
  return (
    <Link
      href={`/record?peak=${peakSlug}&route=${route.id}`}
      className="block rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-bright"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-ink">
              {route.name ?? "Unnamed path"}
            </span>
            {route.is_summit_route && (
              <span className="shrink-0 rounded bg-pine-600/20 px-1.5 py-0.5 text-[10px] font-medium text-pine-600">
                to the summit
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-ink-faint">
            <span>{formatDistance(route.distance_km)}</span>
            {route.ascent_m ? <span>↑ {route.ascent_m} m</span> : null}
            <span>{formatDuration(route.est_time_min)}</span>
            {route.route_type && <span>{route.route_type}</span>}
            {!route.is_summit_route && route.distance_to_summit_m != null && (
              <span>stops {route.distance_to_summit_m} m short</span>
            )}
          </div>
          {access.length > 0 && (
            <div className="mt-1 text-[11px] text-ink-faint">{access.join(" · ")}</div>
          )}
        </div>
        {route.difficulty && (
          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-muted">
            {route.difficulty}
          </span>
        )}
      </div>
    </Link>
  );
}

// Elevation is formatted in several places; keep one implementation.
void formatElevation;

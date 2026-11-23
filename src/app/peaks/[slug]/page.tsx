"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  CATEGORY_LABEL,
  accessInfo,
  formatDistance,
  formatEstimate,
  formatElevation,
  noRoutesMessage,
  type Peak,
  type PeakPhoto,
  type PeakRoute,
  type SummitLog,
} from "@/lib/peak-types";
import { getPeakDownload } from "@/lib/offline";
import { coverageNotice, describeSummitGap, routeCoverage } from "@/lib/summit-gap";
import { describeTripDistance, tripFigures } from "@/lib/trip";
import dynamic from "next/dynamic";
import PeakGallery from "@/components/PeakGallery";
import RouteProfileChart from "@/components/RouteProfileChart";
import HazardPanel from "@/components/HazardPanel";
import { assessHazards, type RouteProfile } from "@/lib/terrain";
import PeakWeather from "@/components/PeakWeather";
import DownloadPeakButton from "@/components/DownloadPeakButton";
import LogSummitPanel from "@/components/LogSummitPanel";
import SaveToListButton from "@/components/SaveToListButton";
import MonthPicker from "@/components/MonthPicker";
import SeasonBadge from "@/components/SeasonBadge";
import { seasonalGrade } from "@/lib/season";
import { useUrlState } from "@/lib/useUrlState";
import Reviews from "@/components/Reviews";

// Mapbox GL touches `window` at import time.
const PeakTerrain3D = dynamic(() => import("@/components/PeakTerrain3D"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-surface-2" />,
});

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
  /** Measured off the terrain model by the 3-D view, keyed by route id. */
  const [profiles, setProfiles] = useState<Map<number, RouteProfile>>(new Map());
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);
  /** Bumped on an explicit pick, so the 3D view knows to fly there. */
  const [focusRoute, setFocusRoute] = useState<{ id: number; nonce: number } | null>(null);
  const terrainRef = useRef<HTMLElement>(null);
  const [weather, setWeather] = useState<{ tempC: number; windKph: number; code: number } | null>(
    null
  );
  const [fromCache, setFromCache] = useState(false);
  // The month window drives the grade, the hazards and the badge. In the
  // URL so a plan for February can be sent to the person you are going with.
  const { state: monthState, set: setMonth } = useUrlState({
    m: new Date().getMonth(),
    mt: new Date().getMonth(),
  });

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
  const ordered = [...summitRoutes, ...approachRoutes];
  const coverage = routeCoverage(routes);
  const activeId = selectedRoute ?? ordered[0]?.id ?? null;

  /**
   * Pick a route: highlight it, and tell the 3D view to fly to it.
   *
   * The nonce is what makes picking the same route twice work — the id
   * alone would not change, so the second click would do nothing. Hovering
   * the terrain still only sets `selectedRoute`, never this, because moving
   * the camera under the cursor makes the map impossible to use.
   */
  /**
   * The figures in the header come from a route that reaches the top, or
   * from nothing at all.
   *
   * This used to take the first of the ordered list, which falls through
   * to an approach trail on the 275 peaks that have no summit route — so
   * Flattop Mountain advertised "Elevation gain 52 m · Est. 15–20 min"
   * under its name, which is the Blueberry Knoll loop at the bottom, not
   * the mountain. A number describing a walk near a peak, printed where
   * the reader expects the climb, is worse than no number: the coverage
   * notice below already says plainly that nothing mapped reaches the top.
   */
  // Of the routes that reach the top, the one that climbs the most is the
  // one that climbs the mountain. Taking the first instead gave Mount
  // Washington the Nelson Crag Trail's stored 11 m of ascent — first in
  // the table, and digitised downhill from the summit — in place of the
  // ~1,100 m its trails actually gain.
  //
  // Not memoised: this sits below the component's early returns, so a
  // hook here breaks the rules of hooks, and sorting a handful of routes
  // costs nothing.
  const headlineRoute =
    [...summitRoutes].sort(
      (a, b) =>
        Math.max(b.ascent_m ?? 0, b.descent_m ?? 0) -
        Math.max(a.ascent_m ?? 0, a.descent_m ?? 0)
    )[0] ?? null;
  const headline = headlineRoute
    ? tripFigures({
        routeType: headlineRoute.route_type,
        profile: profiles.get(headlineRoute.id) ?? null,
        distanceKm: headlineRoute.distance_km,
        ascentM: headlineRoute.ascent_m,
        descentM: headlineRoute.descent_m,
        storedMinutes: headlineRoute.est_time_min,
        difficulty: peak.difficulty,
      })
    : null;

  const pickRoute = (id: number) => {
    setSelectedRoute(id);
    setFocusRoute((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }));
    // On a phone the list sits below the fold, so a fly-to the reader
    // cannot see is no feedback at all.
    terrainRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const activeRoute = ordered.find((r) => r.id === activeId) ?? null;
  const activeProfile = activeId != null ? (profiles.get(activeId) ?? null) : null;

  const hazards = assessHazards({
    summitElevationM: peak.elevation_m,
    difficulty: peak.difficulty,
    profile: activeProfile,
    distanceKm: activeRoute?.distance_km ?? null,
    latitude: peak.latitude,
    month: monthState.m,
    monthTo: monthState.mt,
    weather,
  });

  const grade = seasonalGrade({
    difficulty: peak.difficulty,
    latitude: peak.latitude,
    elevationM: peak.elevation_m,
    from: monthState.m,
    to: monthState.mt,
  });

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

      {/*
        Title block, in the AllTrails arrangement: breadcrumb, then the name
        at full size, then everything else on one quiet line beneath it. The
        previous version opened with a row of coloured pills, so the first
        thing the eye landed on was a badge rather than the mountain's name.
      */}
      <div className="mt-5">
        <nav className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
          <Link href="/peaks" className="hover:text-ink hover:underline">
            Peaks
          </Link>
          {[peak.country, peak.region].filter(Boolean).map((part) => (
            <span key={part} className="flex items-center gap-1.5">
              <span aria-hidden>/</span>
              <span>{part}</span>
            </span>
          ))}
        </nav>

        <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-[2.5rem] sm:leading-[1.1]">
          {peak.name}
        </h1>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-muted">
          <SeasonBadge grade={grade} />
          {peak.category === "highpoint" && (
            <>
              <span aria-hidden>·</span>
              <span>🥇 {peak.region ? `${peak.region} highpoint` : "Highpoint"}</span>
            </>
          )}
          {peak.category === "top_peak" && (
            <>
              <span aria-hidden>·</span>
              <span>{CATEGORY_LABEL.top_peak}</span>
            </>
          )}
          {peak.range_name && (
            <>
              <span aria-hidden>·</span>
              <span>{peak.range_name}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{[peak.region, peak.country].filter(Boolean).join(", ")}</span>
        </div>

        {/*
          The headline figures, sized the way AllTrails sizes them: a large
          number, a small unit, a quiet label underneath. Height and the best
          summit route's length and climb are what someone is here to find
          out, so they are the three that get to be big.
        */}
        <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3 border-b border-border pb-4">
          <Stat value={peak.elevation_m.toLocaleString()} unit="m" label="Elevation" />
          <Stat
            value={Math.round(peak.elevation_m * 3.28084).toLocaleString()}
            unit="ft"
            label="In feet"
          />
          {headline && (
            <>
              <Stat
                value={formatDistance(headline.distanceKm).replace(/\s*km$/, "")}
                unit="km"
                label={headline.roundTrip ? "Round trip" : "Length"}
              />
              {headline.roundTrip && headline.oneWayKm != null && (
                <Stat
                  value={formatDistance(headline.oneWayKm).replace(/\s*km$/, "")}
                  unit="km"
                  label="One way"
                />
              )}
              {headline.ascentM != null && (
                <Stat
                  value={headline.ascentM.toLocaleString()}
                  unit="m"
                  label="Elevation gain"
                />
              )}
              <Stat value={formatEstimate(headline.minutes)} label="Est. time" />
            </>
          )}
        </div>

        {/*
          Saving a peak to a list was only reachable from a route page, via
          a button that saves the route's *parent peak* — so the one screen
          actually about the peak had no way to save it, and a peak with no
          mapped routes could not be saved at all. It belongs here, beside
          the name, which is where AllTrails puts Save too.
        */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Width-capped here rather than in the component: the route
              page stacks it full-width in a sidebar, where that is right. */}
          <div className="w-full max-w-[13rem]">
            <SaveToListButton peakSlug={peak.slug} />
          </div>
          <MonthPicker
            from={monthState.m}
            to={monthState.mt}
            onChange={({ from, to }) => setMonth({ m: from, mt: to })}
          />
        </div>

        {/* Spelled out when the month actually changes the grade — the
            badge alone cannot carry why a walk-up became a climb. */}
        {grade.steps > 0 && (
          <p className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">{grade.label}.</span> {grade.detail}
          </p>
        )}
      </div>

      {/* The mountain itself */}
      {typeof window !== "undefined" && (
        <section className="mt-5" ref={terrainRef}>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-display text-lg font-bold text-ink">The mountain in 3D</h2>
            <span className="text-xs text-ink-faint">
              {routes.length > 0 ? "summit paths drawn on the terrain" : "terrain view"}
            </span>
          </div>
          <PeakTerrain3D
            peak={peak}
            routes={routes}
            activeRouteId={activeId}
            focusRoute={focusRoute}
            onRouteHover={(id) => id != null && setSelectedRoute(id)}
            onProfile={setProfiles}
            className="h-[22rem] sm:h-[30rem]"
          />
        </section>
      )}

      {/* The rest of the facts. Elevation and its conversion live in the
          header now, so repeating them here would just be noise. */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
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
          {/* Counts the routes that reach it, not every line near the
              mountain — "Routes to the summit 16" beside sixteen trails
              that all stop short was a claim the page then contradicted. */}
          {summitRoutes.length > 0 && (
            <span className="ml-2 text-sm font-normal text-ink-faint">{summitRoutes.length}</span>
          )}
        </h2>

        {routes.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-ink-muted">
            {noRoutesMessage(peak)}
          </p>
        ) : (
          <>
            {/*
              A peak whose paths all stop below the top used to look exactly
              like one with a summit trail — the list was full, nothing said
              otherwise. On 188 peaks that is the single most important fact
              on the page, so it goes above the list rather than being left
              for the reader to infer from every row saying "stops short".
            */}
            {coverage !== "summit" && (
              <div className="mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                <p className="text-sm font-semibold text-ink">
                  {coverageNotice(coverage, routes.length)?.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  {coverageNotice(coverage, routes.length)?.body}
                </p>
              </div>
            )}

            {/*
              The two groups are separated structurally, not by a badge on
              a row in one long list. A path that stops 998 m below the
              summit is not a worse way up this mountain, it is not a way
              up this mountain, and putting it under the same heading as
              the climb invites exactly that reading. Mount Juneau listed
              the Gold Creek Flume — a valley walk — directly beneath the
              trail that climbs 844 m to the top.
            */}
            {summitRoutes.length > 0 && (
              <div className="space-y-2">
                {summitRoutes.map((r) => (
                  <RouteRow
                    key={r.id}
                    route={r}
                    peakSlug={peak.slug}
                    profile={profiles.get(r.id) ?? null}
                    difficulty={peak.difficulty}
                    summitElevationM={peak.elevation_m}
                    selected={r.id === activeId}
                    onSelect={() => pickRoute(r.id)}
                  />
                ))}
              </div>
            )}

            {approachRoutes.length > 0 && (
              <div className={summitRoutes.length > 0 ? "mt-6" : ""}>
                <h3 className="mb-1 font-display text-base font-bold text-ink">
                  Other trails on this mountain
                  <span className="ml-2 text-sm font-normal text-ink-faint">
                    {approachRoutes.length}
                  </span>
                </h3>
                <p className="mb-2.5 text-xs text-ink-muted">
                  {summitRoutes.length > 0
                    ? "These approach the peak but stop below the summit."
                    : "Mapped paths near the peak. None of them reach the top."}
                </p>
                <div className="space-y-2">
                  {approachRoutes.map((r) => (
                    <RouteRow
                      key={r.id}
                      route={r}
                      peakSlug={peak.slug}
                      profile={profiles.get(r.id) ?? null}
                      difficulty={peak.difficulty}
                      summitElevationM={peak.elevation_m}
                      selected={r.id === activeId}
                      onSelect={() => pickRoute(r.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Profile of whichever route is selected. */}
            <div className="mt-3">
              <RouteProfileChart profile={activeProfile} />
            </div>
          </>
        )}
      </section>

      <div className="mt-6">
        <HazardPanel hazards={hazards} />
      </div>

      <div className="mt-4">
        <PeakWeather
          latitude={peak.latitude}
          longitude={peak.longitude}
          elevationM={peak.elevation_m}
          onCurrent={setWeather}
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

function RouteRow({
  route,
  peakSlug,
  profile,
  difficulty,
  summitElevationM,
  selected,
  onSelect,
}: {
  route: PeakRoute;
  peakSlug: string;
  profile: RouteProfile | null;
  difficulty: Peak["difficulty"];
  summitElevationM: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const access = accessInfo(route);
  // Prefer what we measured off the terrain over what the import guessed,
  // and describe the whole trip rather than the stored one-way line — see
  // `tripFigures`.
  const trip = tripFigures({
    routeType: route.route_type,
    profile,
    distanceKm: route.distance_km,
    ascentM: route.ascent_m,
    descentM: route.descent_m,
    storedMinutes: route.est_time_min,
    difficulty,
  });
  const tripDistance = describeTripDistance(trip);
  const ascent = trip.ascentM;
  const minutes = trip.minutes;
  // The live profile, when the terrain has loaded, knows the high point
  // better than the stored column does — and agrees with the chart drawn
  // below this row, which the stored value might not.
  const gap = describeSummitGap({
    isSummitRoute: route.is_summit_route,
    distanceToSummitM: route.distance_to_summit_m,
    highPointM: profile?.maxEle ?? route.high_point_m,
    summitElevationM,
  });

  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={`block cursor-pointer rounded-xl border bg-surface p-3 transition-colors ${
        selected ? "border-pine-600 ring-1 ring-pine-600/30" : "border-border hover:border-border-bright"
      }`}
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
            {/* Both distances, every time — see `describeTripDistance`. */}
            <span>{tripDistance.primary}</span>
            {tripDistance.secondary && <span>{tripDistance.secondary}</span>}
            {ascent ? <span>↑ {ascent.toLocaleString()} m</span> : null}
            <span>{formatEstimate(minutes)}</span>
            {profile ? <span>max {profile.maxGrade}%</span> : null}
            {route.route_type && <span>{route.route_type}</span>}
            {gap && <span title={gap.detail}>{gap.label}</span>}
          </div>
          {access.length > 0 && (
            <div className="mt-1 text-[11px] text-ink-faint">{access.join(" · ")}</div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {route.difficulty && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-muted">
              {route.difficulty}
            </span>
          )}
          <Link
            href={`/record?peak=${peakSlug}&route=${route.id}`}
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg bg-pine-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-pine-500"
          >
            Navigate
          </Link>
        </div>
      </div>
    </div>
  );
}

// Elevation is formatted in several places; keep one implementation.
void formatElevation;

/**
 * One headline figure: a large number, a small unit, a quiet label.
 *
 * The size difference is the point — it lets someone read the three
 * numbers that matter off the page without reading any words.
 */
function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div>
      <div className="font-display text-2xl font-bold leading-none tracking-tight text-ink">
        {value}
        {unit && <span className="ml-0.5 text-sm font-semibold text-ink-muted">{unit}</span>}
      </div>
      <div className="mt-1 text-xs text-ink-faint">{label}</div>
    </div>
  );
}

"use client";

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Map, { type Bounds } from "@/components/Map";
import FilterSheet from "@/components/FilterSheet";
import LocationSearch from "@/components/LocationSearch";
import type { Peak, Route } from "@/lib/types";
import { getDifficulty, getDifficultyColor } from "@/lib/types";
import { type Filters, DEFAULT_FILTERS, routeMatches, activeFilterCount } from "@/lib/filters";
import type { GeocodeResult } from "@/lib/geocode";

const supabase = createClient();

function minElevationForZoom(zoom: number): number {
  if (zoom < 5) return 3000;
  if (zoom < 7) return 2000;
  if (zoom < 9) return 1000;
  if (zoom < 11) return 400;
  return 0;
}

function ExploreInner() {
  const searchParams = useSearchParams();
  const focusRouteId = searchParams.get("route");
  const focusPeakId = searchParams.get("peak");

  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [initialCenter] = useState<[number, number]>([39.63, -106.37]);
  const [loading, setLoading] = useState(false);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [focusBounds, setFocusBounds] = useState<[number, number, number, number] | null>(null);
  const [isolating, setIsolating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<"peaks" | "routes">("peaks");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Isolate a single route when arriving from a trail page (?route=id)
  useEffect(() => {
    if (!focusRouteId) { setIsolating(false); return; }
    (async () => {
      const { data } = await supabase.from("routes").select("*").eq("id", focusRouteId).single();
      if (data) {
        const r = data as Route;
        setIsolating(true);
        setActiveRoute(r);
        setRoutes([r]);
        setFocusBounds([r.bbox_min_lng, r.bbox_min_lat, r.bbox_max_lng, r.bbox_max_lat]);
        setTab("routes");
      }
    })();
  }, [focusRouteId]);

  // Fly to a single peak when arriving from a peak page (?peak=id)
  useEffect(() => {
    if (!focusPeakId) return;
    (async () => {
      const { data } = await supabase.from("peaks").select("*").eq("id", focusPeakId).single();
      if (data) {
        const p = data as Peak;
        setFocusBounds([p.longitude - 0.06, p.latitude - 0.06, p.longitude + 0.06, p.latitude + 0.06]);
        setTab("peaks");
      }
    })();
  }, [focusPeakId]);

  // Stable guard — true whenever a ?route= param is present, so an in-flight
  // viewport fetch can never clobber the isolated route.
  const isolatingRef = useRef(false);
  isolatingRef.current = !!focusRouteId;

  const handleBoundsChange = useCallback((b: Bounds) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      const [peakRes, routeRes] = await Promise.all([
        supabase.rpc("peaks_in_bounds", {
          min_lat: b.minLat, min_lng: b.minLng, max_lat: b.maxLat, max_lng: b.maxLng,
          min_elevation: minElevationForZoom(b.zoom), lim: 400,
        }),
        b.zoom >= 6 && !isolatingRef.current
          ? supabase.rpc("routes_in_bounds", {
              min_lat: b.minLat, min_lng: b.minLng, max_lat: b.maxLat, max_lng: b.maxLng, lim: 100,
            })
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (!peakRes.error && peakRes.data) setPeaks(peakRes.data as Peak[]);
      if (!isolatingRef.current && !routeRes.error && routeRes.data) setRoutes(routeRes.data as Route[]);
      setLoading(false);
    }, 400);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const jumpToPlace = (place: GeocodeResult | null) => {
    if (place?.bbox) setFocusBounds(place.bbox);
    else if (place) setFocusBounds([place.center[0] - 0.3, place.center[1] - 0.3, place.center[0] + 0.3, place.center[1] + 0.3]);
  };

  // Apply filters client-side to what's loaded
  const shownPeaks = useMemo(() => {
    let ps = peaks;
    if (filters.iconicOnly) ps = ps.filter((p) => p.is_iconic);
    if (filters.difficulty.length) ps = ps.filter((p) => filters.difficulty.includes(getDifficulty(p.elevation)));
    return ps;
  }, [peaks, filters.difficulty, filters.iconicOnly]);

  const shownRoutes = useMemo(() =>
    isolating ? routes : routes.filter((r) => routeMatches(r, filters)),
    [routes, filters, isolating]);

  const nFilters = activeFilterCount(filters);
  const list = tab === "peaks" ? shownPeaks : shownRoutes;

  return (
    // Mobile uses dvh (dynamic viewport) so the map isn't overgrown behind
    // iOS Safari's collapsing toolbars; desktop keeps the fixed top-nav offset.
    <div className="relative h-[calc(100dvh-4rem)] md:h-[calc(100vh-4rem)]">
      <Map
        peaks={shownPeaks}
        routes={shownRoutes}
        initialCenter={initialCenter}
        onBoundsChange={handleBoundsChange}
        onPeakClick={() => setSheetOpen(true)}
        onRouteClick={(r) => { setActiveRoute(r); setTab("routes"); setSheetOpen(true); }}
        activeRouteId={activeRoute?.id}
        focusBounds={focusBounds}
      />

      {/* Top overlay: location search + filters. top offset respects the iOS
          Dynamic Island / status bar via env(safe-area-inset-top). */}
      <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex items-center gap-2">
        <div className="w-full max-w-xs">
          <LocationSearch selected={null} onSelect={jumpToPlace} placeholder="Search a mountain or place..." />
        </div>
        <button onClick={() => setFilterOpen(true)}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-border bg-ground/90 px-3 py-2.5 text-sm font-medium text-ink backdrop-blur transition-colors hover:bg-surface">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
          </svg>
          {nFilters > 0 && <span className="rounded-full bg-pine-500 px-1.5 text-xs font-semibold text-white">{nFilters}</span>}
        </button>
      </div>

      {/* Isolated route banner */}
      {isolating && activeRoute && (
        <div className="absolute left-1/2 top-16 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-trail-500/40 bg-ground/90 px-4 py-2 text-sm backdrop-blur">
          <span className="truncate max-w-[50vw] font-medium text-ink">🥾 {activeRoute.name}</span>
          <Link href="/explore" onClick={() => { setIsolating(false); setRoutes([]); }}
            className="text-trail-600 hover:text-trail-500">Show all</Link>
        </div>
      )}

      {/* Status pill */}
      <div className="pointer-events-none absolute left-3 bottom-20 z-10 flex items-center gap-2 rounded-full border border-border bg-ground/85 px-3.5 py-1.5 text-sm font-medium text-ink backdrop-blur sm:bottom-4">
        {loading ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-border-bright border-t-pine-400" />
                 : <span className="h-2 w-2 rounded-full bg-pine-400" />}
        <span className="font-display">{shownPeaks.length}</span> peaks
        {shownRoutes.length > 0 && (<><span className="text-ink-faint">·</span><span className="font-display text-trail-500">{shownRoutes.length}</span> routes</>)}
      </div>

      {/* Sheet toggle */}
      <button onClick={() => setSheetOpen((s) => !s)}
        className="absolute bottom-20 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-ground/90 px-5 py-2.5 text-sm font-semibold text-ink shadow-xl backdrop-blur transition-colors hover:bg-surface sm:bottom-4">
        {sheetOpen ? "Hide list" : `Browse ${shownPeaks.length} peaks · ${shownRoutes.length} routes`}
      </button>

      {/* Bottom sheet list */}
      <div className={`absolute inset-x-0 bottom-0 z-30 max-h-[68%] overflow-hidden rounded-t-3xl border-t border-border bg-ground shadow-2xl transition-transform duration-300 ${sheetOpen ? "translate-y-0" : "translate-y-full"}`}>
        <div className="flex items-center justify-between px-5 pb-3 pt-4">
          <div className="flex gap-1 rounded-xl border border-border bg-surface p-1">
            <button onClick={() => setTab("peaks")} className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${tab === "peaks" ? "bg-pine-600 text-white" : "text-ink-muted"}`}>Peaks {shownPeaks.length}</button>
            <button onClick={() => setTab("routes")} className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${tab === "routes" ? "bg-trail-600 text-white" : "text-ink-muted"}`}>Routes {shownRoutes.length}</button>
          </div>
          <button onClick={() => setSheetOpen(false)} className="rounded-full p-2 text-ink-muted hover:bg-surface">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="max-h-[calc(68vh-4.5rem)] overflow-y-auto px-4 pb-6">
          {list.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-faint">{tab === "peaks" ? "No peaks in view." : "No routes in view."}</p>
          ) : tab === "peaks" ? (
            <div className="space-y-2">
              {shownPeaks.map((peak) => {
                const diff = getDifficulty(peak.elevation);
                return (
                  <Link key={peak.id} href={`/peaks/${peak.id}`} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-colors hover:border-border-bright">
                    <div className="topo-texture flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2">
                      {peak.photo_url ? <img src={peak.photo_url} alt="" className="h-full w-full object-cover" /> : <span className="text-xl opacity-40">⛰</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display font-semibold text-ink">{peak.name || "Unnamed Peak"}</div>
                      <div className="text-sm text-ink-muted">{peak.country}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {peak.elevation && <span className="font-mono text-sm font-medium text-pine-600">{peak.elevation.toLocaleString()}m</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getDifficultyColor(diff)}`}>{diff}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {shownRoutes.map((route) => (
                <Link key={route.id} href={`/routes/${route.id}`} onMouseEnter={() => setActiveRoute(route)}
                  className={`flex items-center gap-3 rounded-2xl border p-3 transition-colors ${activeRoute?.id === route.id ? "border-trail-500 bg-surface-2" : "border-border bg-surface hover:border-border-bright"}`}>
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-trail-500/15 text-xl">🥾</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display font-semibold text-ink">{route.name || "Unnamed Route"}</div>
                    <div className="text-sm text-ink-muted">{route.distance_km ? `${route.distance_km.toFixed(1)} km` : ""}{route.route_type ? ` · ${route.route_type}` : ""}</div>
                  </div>
                  {route.difficulty && <span className="rounded-full bg-trail-500/15 px-2 py-0.5 text-[10px] font-semibold text-trail-500">{route.difficulty}</span>}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <FilterSheet open={filterOpen} filters={filters} onChange={setFilters} onClose={() => setFilterOpen(false)}
        resultCount={tab === "peaks" ? shownPeaks.length : shownRoutes.length} />
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="flex h-[calc(100dvh-4rem)] items-center justify-center md:h-[calc(100vh-4rem)]"><div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-pine-400" /></div>}>
      <ExploreInner />
    </Suspense>
  );
}

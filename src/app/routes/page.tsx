"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import RouteCard from "@/components/RouteCard";
import FilterSheet from "@/components/FilterSheet";
import LocationSearch from "@/components/LocationSearch";
import type { Route } from "@/lib/types";
import { type Filters, DEFAULT_FILTERS, applyRouteFilters, activeFilterCount } from "@/lib/filters";
import type { GeocodeResult } from "@/lib/geocode";

const supabase = createClient();
const PAGE_SIZE = 24;

// Every trail row carries its full GeoJSON geometry, which is by far the
// largest column. Ranking candidates for "Most popular" only needs the id and
// a tiebreak, so ask for those two columns and fetch whole rows for the single
// page actually rendered. Pulling geometry for 300 trails moved megabytes per
// request and timed out once the table passed ~90k rows.
const RANK_COLUMNS = "id,distance_km";

// Waymarked networks: international, national, and regional walking routes.
// With ~95k trails, ranking an arbitrary 300 surfaces forest tracks nobody
// searches for. A network tag is the strongest "this is a real, signposted
// trail" signal OSM carries, so popularity draws from that pool first.
const WAYMARKED = ["iwn", "nwn", "rwn"];

async function fetchRoutes(
  search: string, filters: Filters, place: GeocodeResult | null,
  radiusOn: boolean, sortBy: string, page: number
): Promise<Route[]> {
  // Two builders over the same predicates: `q` returns full rows for a page,
  // `qRank` returns only the columns needed to rank candidates.
  let q = supabase.from("routes").select("*").not("name", "is", null);
  let qRank = supabase.from("routes").select(RANK_COLUMNS).not("name", "is", null);
  // Same predicates again, for the unrestricted fallback pool. A PostgREST
  // builder is single-use, so the two cannot share one object.
  let qAll = supabase.from("routes").select(RANK_COLUMNS).not("name", "is", null);
  if (search) {
    q = q.ilike("name", `%${search}%`);
    qRank = qRank.ilike("name", `%${search}%`);
    qAll = qAll.ilike("name", `%${search}%`);
  }
  q = applyRouteFilters(q, filters);
  qRank = applyRouteFilters(qRank, filters);
  qAll = applyRouteFilters(qAll, filters);

  // Area filter: routes whose bbox overlaps the searched place's bbox.
  // Skipped when the radius toggle is off, so a place search can span everywhere.
  if (place?.bbox && radiusOn) {
    const [minLng, minLat, maxLng, maxLat] = place.bbox;
    q = q
      .lte("bbox_min_lat", maxLat).gte("bbox_max_lat", minLat)
      .lte("bbox_min_lng", maxLng).gte("bbox_max_lng", minLng);
    // The ranking query must carry the same area predicate, or "Most popular"
    // would rank trails from outside the searched area.
    qRank = qRank
      .lte("bbox_min_lat", maxLat).gte("bbox_max_lat", minLat)
      .lte("bbox_min_lng", maxLng).gte("bbox_max_lng", minLng);
    qAll = qAll
      .lte("bbox_min_lat", maxLat).gte("bbox_max_lat", minLat)
      .lte("bbox_min_lng", maxLng).gte("bbox_max_lng", minLng);
  }

  // "Most popular": rank by how many named peaks a route crosses (peak_count).
  // That's a computed count, not a column, so fetch a wide set, tally from the
  // route_peaks junction, sort, and paginate client-side.
  if (sortBy === "popular") {
    // Prefer signposted routes; fall back to everything if that pool is too
    // thin once the user's filters, search, or area are applied.
    type Candidate = { id: number; distance_km: number | null };
    let candidates: Candidate[] = [];

    const waymarked = await qRank.in("network", WAYMARKED).limit(300);
    if (!waymarked.error) candidates = (waymarked.data ?? []) as Candidate[];

    if (candidates.length < PAGE_SIZE * (page + 1)) {
      const all = await qAll.limit(300);
      if (all.error && candidates.length === 0) throw all.error;
      const seen = new Set(candidates.map((c) => c.id));
      for (const c of ((all.data ?? []) as Candidate[])) {
        if (!seen.has(c.id)) candidates.push(c);
      }
    }
    if (candidates.length === 0) return [];

    const { data: links } = await supabase
      .from("route_peaks").select("route_id").in("route_id", candidates.map((r) => r.id));
    const counts = new Map<number, number>();
    ((links ?? []) as { route_id: number }[]).forEach((l) =>
      counts.set(l.route_id, (counts.get(l.route_id) ?? 0) + 1));

    candidates.sort((a, b) =>
      ((counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)) ||
      ((b.distance_km ?? 0) - (a.distance_km ?? 0)));

    // …then hydrate only the page being shown.
    const pageIds = candidates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((r) => r.id);
    if (pageIds.length === 0) return [];
    const { data: full } = await supabase.from("routes").select("*").in("id", pageIds);
    const byId = new Map((((full ?? []) as Route[])).map((r) => [r.id, r]));
    return pageIds
      .map((id) => byId.get(id))
      .filter((r): r is Route => !!r)
      .map((r) => ({ ...r, peak_count: counts.get(r.id) ?? 0 }));
  }

  q = q.order(sortBy, { ascending: false, nullsFirst: false })
       .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  const { data, error } = await q;
  if (error) throw error;
  return (data as Route[]) ?? [];
}

export default function RoutesBrowsePage() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [place, setPlace] = useState<GeocodeResult | null>(null);
  const [radiusOn, setRadiusOn] = useState(true);
  const [sortBy, setSortBy] = useState("popular");
  const [page, setPage] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);

  // React Query caches each unique combination — revisiting is instant.
  const { data: routes = [], isLoading } = useQuery({
    queryKey: ["routes", search, filters, place?.name ?? null, radiusOn, sortBy, page],
    queryFn: () => fetchRoutes(search, filters, place, radiusOn, sortBy, page),
    placeholderData: (prev) => prev, // keep old results visible while refetching
  });

  const nFilters = activeFilterCount(filters);
  const reset = (patch: () => void) => { patch(); setPage(0); };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="font-display text-3xl font-extrabold text-ink">Trails & Routes</h1>
      <p className="mt-2 text-ink-muted">Hiking routes with distance, elevation, and the peaks they cross</p>

      {/* Controls row */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:w-72">
          <LocationSearch selected={place} onSelect={(p) => reset(() => setPlace(p))} />
        </div>

        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input type="text" value={search}
            onChange={(e) => reset(() => setSearch(e.target.value))}
            placeholder="Search trails by name..."
            className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-ink placeholder-ink-faint outline-none focus:border-pine-500" />
        </div>

        <button onClick={() => setFilterOpen(true)}
          className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-border-bright">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
          </svg>
          Filters
          {nFilters > 0 && <span className="rounded-full bg-pine-500 px-1.5 text-xs font-semibold text-white">{nFilters}</span>}
        </button>

        <select value={sortBy} onChange={(e) => reset(() => setSortBy(e.target.value))}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink-muted outline-none">
          <option value="popular">Most popular</option>
          <option value="distance_km">Longest</option>
          <option value="est_time_min">Most time</option>
        </select>
      </div>

      {/* Active area chip + radius toggle */}
      {place && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          <span>
            {radiusOn ? "Trails near " : "Searching everywhere · centred on "}
            <span className="font-medium text-pine-600">{place.name}</span>
          </span>
          <button
            type="button"
            onClick={() => reset(() => setRadiusOn((v) => !v))}
            role="switch"
            aria-checked={radiusOn}
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              radiusOn ? "border-pine-600 bg-pine-600/10 text-pine-700" : "border-border bg-surface text-ink-muted"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${radiusOn ? "bg-pine-600" : "bg-ink-faint"}`} />
            {radiusOn ? "Limit to this area" : "Area filter off"}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-trail-500" />
        </div>
      ) : routes.length === 0 ? (
        <div className="py-20 text-center text-ink-faint">No trails match your filters. Try widening them.</div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {routes.map((r) => <RouteCard key={r.id} route={r} />)}
          </div>
          <div className="mt-8 flex items-center justify-center gap-4">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
              className="rounded-lg border border-border px-4 py-2 text-sm text-ink-muted transition-colors hover:bg-surface disabled:opacity-30">Previous</button>
            <span className="text-sm text-ink-muted">Page {page + 1}</span>
            <button onClick={() => setPage(page + 1)} disabled={routes.length < PAGE_SIZE}
              className="rounded-lg border border-border px-4 py-2 text-sm text-ink-muted transition-colors hover:bg-surface disabled:opacity-30">Next</button>
          </div>
        </>
      )}

      <FilterSheet open={filterOpen} filters={filters}
        onChange={(f) => reset(() => setFilters(f))}
        onClose={() => setFilterOpen(false)}
        resultCount={routes.length} />
    </div>
  );
}

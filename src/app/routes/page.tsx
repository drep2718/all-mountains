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

async function fetchRoutes(
  search: string, filters: Filters, place: GeocodeResult | null,
  sortBy: string, page: number
): Promise<Route[]> {
  let q = supabase.from("routes").select("*").not("name", "is", null);
  if (search) q = q.ilike("name", `%${search}%`);
  q = applyRouteFilters(q, filters);

  // Area filter: routes whose bbox overlaps the searched place's bbox
  if (place?.bbox) {
    const [minLng, minLat, maxLng, maxLat] = place.bbox;
    q = q
      .lte("bbox_min_lat", maxLat).gte("bbox_max_lat", minLat)
      .lte("bbox_min_lng", maxLng).gte("bbox_max_lng", minLng);
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
  const [sortBy, setSortBy] = useState("distance_km");
  const [page, setPage] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);

  // React Query caches each unique combination — revisiting is instant.
  const { data: routes = [], isLoading } = useQuery({
    queryKey: ["routes", search, filters, place?.name ?? null, sortBy, page],
    queryFn: () => fetchRoutes(search, filters, place, sortBy, page),
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

        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
          className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-ink-muted outline-none">
          <option value="distance_km">Longest</option>
          <option value="est_time_min">Most time</option>
        </select>
      </div>

      {/* Active area chip */}
      {place && (
        <p className="mt-3 text-sm text-ink-muted">
          Showing trails in <span className="font-medium text-pine-600">{place.name}</span>
        </p>
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

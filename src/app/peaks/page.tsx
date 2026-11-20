"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PeakCard from "@/components/PeakCard";
import LocationSearch from "@/components/LocationSearch";
import { decodePlace, encodePlace, type GeocodeResult } from "@/lib/geocode";
import { useUrlState } from "@/lib/useUrlState";
import type { Peak, PeakDifficulty, PeakCategory } from "@/lib/peak-types";
import { DIFFICULTY_LABEL } from "@/lib/peak-types";

// Difficulty is now a property of the climb, stated by the catalogue, not
// derived from elevation — which used to call every 800 m scramble "Easy".
const difficulties: PeakDifficulty[] = ["hike", "scramble", "technical"];

/**
 * Defaults, and by the same token the shape of the URL.
 *
 * A value equal to its default is left out of the query string, so a plain
 * browse stays at `/peaks` and only what you actually changed shows up.
 * `radius` is inverted (`noRadius`) for that reason: the filter is on by
 * default, and encoding the common case would put `radius=1` in every URL.
 */
const FILTER_DEFAULTS = {
  q: "",
  difficulty: "All",
  iconic: false,
  sort: "popular",
  place: "",
  noRadius: false,
  page: 0,
};

export default function PeaksPage() {
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [loading, setLoading] = useState(true);
  const { state, set, reset, ready } = useUrlState(FILTER_DEFAULTS);

  const search = state.q;
  const difficulty = state.difficulty as PeakDifficulty | "All";
  const iconicOnly = state.iconic;
  const sortBy = state.sort as "popular" | "elevation" | "name";
  const radiusOn = !state.noRadius;
  const page = state.page;
  const place = useMemo<GeocodeResult | null>(
    () => (state.place ? decodePlace(state.place) : null),
    [state.place]
  );

  const supabase = createClient();
  const pageSize = 24;

  useEffect(() => {
    // Hold until the URL has been read, or the first paint fires a query
    // against the defaults and visibly discards the restored filters.
    if (!ready) return;

    async function fetch() {
      setLoading(true);

      // This queries the peaks table directly using Supabase's query builder.
      // The query builder translates to SQL under the hood via PostgREST.
      let query = supabase
        .from("peaks")
        .select("*")
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (search) {
        query = query.ilike("name", `%${search}%`);
      }

      if (iconicOnly) {
        query = query.eq("category", "highpoint" satisfies PeakCategory);
      }

      // Filter in the query, not after paging — filtering a page client-side
      // silently returns fewer than pageSize results and looks like data loss.
      if (difficulty !== "All") {
        query = query.eq("difficulty", difficulty);
      }

      // Area filter: peaks whose coordinates fall inside the searched
      // mountain/place box. Skipped when the radius toggle is off.
      if (place?.bbox && radiusOn) {
        const [minLng, minLat, maxLng, maxLat] = place.bbox;
        query = query
          .gte("latitude", minLat).lte("latitude", maxLat)
          .gte("longitude", minLng).lte("longitude", maxLng);
      }

      if (sortBy === "popular") {
        // Popularity proxy: curated iconic summits first, then the most
        // prominent, then the highest — the peaks people actually seek out.
        // Popularity proxy: highpoints first, then the most prominent, then
        // the ones with the most mapped routes.
        query = query
          .order("category", { ascending: true })
          .order("prominence_m", { ascending: false, nullsFirst: false })
          .order("route_count", { ascending: false })
          .order("elevation_m", { ascending: false });
      } else if (sortBy === "elevation") {
        query = query.order("elevation_m", { ascending: false });
      } else {
        query = query.order("name", { ascending: true, nullsFirst: false });
      }

      const { data, error } = await query;

      if (!error && data) setPeaks(data as Peak[]);
      setLoading(false);
    }

    const debounce = setTimeout(fetch, search ? 300 : 0);
    return () => clearTimeout(debounce);
  }, [search, difficulty, iconicOnly, sortBy, place, radiusOn, page, ready]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-100">Browse Peaks</h1>
        <p className="mt-2 text-slate-400">
          Every summit in the catalogue — search by name, height or how hard it is
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <LocationSearch
            selected={place}
            onSelect={(p) => set({ place: p ? encodePlace(p) : "", page: 0 })}
            placeholder="Search a mountain or place..."
          />
        </div>

        <div className="relative flex-1 sm:max-w-md">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => set({ q: e.target.value, page: 0 })}
            placeholder="Search peaks..."
            className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-alpine-500"
          />
        </div>

        <div className="flex gap-1 rounded-xl border border-slate-700 bg-slate-900 p-1">
          {(["All", ...difficulties] as const).map((d) => (
            <button
              key={d}
              onClick={() => set({ difficulty: d, page: 0 })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                difficulty === d
                  ? "bg-alpine-600 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {d === "All" ? "All" : DIFFICULTY_LABEL[d]}
            </button>
          ))}
        </div>

        <button
          onClick={() => set({ iconic: !iconicOnly, page: 0 })}
          className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors ${
            iconicOnly ? "border-[#e8b33a] bg-[#e8b33a]/15 text-[#e8b33a]" : "border-slate-700 bg-slate-900 text-slate-300 hover:text-slate-100"
          }`}
        >
          🥇 Iconic
        </button>

        <select
          value={sortBy}
          onChange={(e) => set({ sort: e.target.value, page: 0 })}
          className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-300 outline-none"
        >
          <option value="popular">Most popular</option>
          <option value="elevation">Highest First</option>
          <option value="name">A → Z</option>
        </select>
      </div>

      {/* Active area chip + radius toggle */}
      {place && (
        <div className="mb-6 -mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <span>
            {radiusOn ? "Peaks near " : "Searching everywhere · centred on "}
            <span className="font-medium text-alpine-600">{place.name}</span>
          </span>
          <button
            type="button"
            onClick={() => set({ noRadius: radiusOn, page: 0 })}
            role="switch"
            aria-checked={radiusOn}
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              radiusOn ? "border-alpine-600 bg-alpine-500/10 text-alpine-600" : "border-slate-700 bg-slate-900 text-slate-400"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${radiusOn ? "bg-alpine-500" : "bg-slate-500"}`} />
            {radiusOn ? "Limit to this area" : "Area filter off"}
          </button>
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-alpine-500" />
        </div>
      ) : peaks.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-slate-500">No peaks found. Try a different search or filter.</p>
          {/* Now that filters persist across navigation, they can also follow
              you back from a shared link — so there has to be one obvious way
              out of a combination that matches nothing. */}
          <button
            onClick={reset}
            className="mt-4 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {peaks.map((peak) => (
              <PeakCard key={peak.slug} peak={peak} />
            ))}
          </div>

          {/* Pagination */}
          <div className="mt-8 flex items-center justify-center gap-4">
            <button
              onClick={() => set({ page: Math.max(0, page - 1) })}
              disabled={page === 0}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-sm text-slate-400">Page {page + 1}</span>
            <button
              onClick={() => set({ page: page + 1 })}
              disabled={peaks.length < pageSize}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

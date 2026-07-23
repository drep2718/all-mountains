"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import PeakCard from "@/components/PeakCard";
import LocationSearch from "@/components/LocationSearch";
import type { GeocodeResult } from "@/lib/geocode";
import type { Peak, Difficulty } from "@/lib/types";
import { getDifficulty } from "@/lib/types";

const difficulties: Difficulty[] = ["Easy", "Moderate", "Hard", "Expert", "Extreme"];

export default function PeaksPage() {
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty | "All">("All");
  const [iconicOnly, setIconicOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"popular" | "elevation" | "name">("popular");
  const [place, setPlace] = useState<GeocodeResult | null>(null);
  const [radiusOn, setRadiusOn] = useState(true);
  const [page, setPage] = useState(0);
  const supabase = createClient();
  const pageSize = 24;

  useEffect(() => {
    async function fetch() {
      setLoading(true);

      // This queries the peaks table directly using Supabase's query builder.
      // The query builder translates to SQL under the hood via PostgREST.
      let query = supabase
        .from("peaks")
        .select("*")
        .not("name", "is", null)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (search) {
        query = query.ilike("name", `%${search}%`);
      }

      if (iconicOnly) {
        query = query.eq("is_iconic", true);
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
        query = query
          .order("is_iconic", { ascending: false, nullsFirst: false })
          .order("prominence", { ascending: false, nullsFirst: false })
          .order("elevation", { ascending: false, nullsFirst: false });
      } else if (sortBy === "elevation") {
        query = query.order("elevation", { ascending: false, nullsFirst: false });
      } else {
        query = query.order("name", { ascending: true, nullsFirst: false });
      }

      const { data, error } = await query;

      if (!error && data) {
        let filtered = data as Peak[];
        if (difficulty !== "All") {
          filtered = filtered.filter(
            (p) => getDifficulty(p.elevation) === difficulty
          );
        }
        setPeaks(filtered);
      }
      setLoading(false);
    }

    const debounce = setTimeout(fetch, search ? 300 : 0);
    return () => clearTimeout(debounce);
  }, [search, difficulty, iconicOnly, sortBy, place, radiusOn, page]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-100">Browse Peaks</h1>
        <p className="mt-2 text-slate-400">
          Explore mountains worldwide by name, elevation, or difficulty
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <LocationSearch
            selected={place}
            onSelect={(p) => { setPlace(p); setPage(0); }}
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
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search peaks..."
            className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-alpine-500"
          />
        </div>

        <div className="flex gap-1 rounded-xl border border-slate-700 bg-slate-900 p-1">
          {["All", ...difficulties].map((d) => (
            <button
              key={d}
              onClick={() => { setDifficulty(d as Difficulty | "All"); setPage(0); }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                difficulty === d
                  ? "bg-alpine-600 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        <button
          onClick={() => { setIconicOnly((v) => !v); setPage(0); }}
          className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors ${
            iconicOnly ? "border-[#e8b33a] bg-[#e8b33a]/15 text-[#e8b33a]" : "border-slate-700 bg-slate-900 text-slate-300 hover:text-slate-100"
          }`}
        >
          🥇 Iconic
        </button>

        <select
          value={sortBy}
          onChange={(e) => { setSortBy(e.target.value as "popular" | "elevation" | "name"); setPage(0); }}
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
            onClick={() => { setRadiusOn((v) => !v); setPage(0); }}
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
        <div className="py-20 text-center text-slate-500">
          No peaks found. Try a different search or filter.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {peaks.map((peak) => (
              <PeakCard key={peak.id} peak={peak} />
            ))}
          </div>

          {/* Pagination */}
          <div className="mt-8 flex items-center justify-center gap-4">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-30"
            >
              Previous
            </button>
            <span className="text-sm text-slate-400">Page {page + 1}</span>
            <button
              onClick={() => setPage(page + 1)}
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

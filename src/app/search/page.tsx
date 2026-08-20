"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { searchAll } from "@/lib/search";
import PeakCard from "@/components/PeakCard";
import RouteCard from "@/components/RouteCard";

type Tab = "all" | "peaks" | "trails";

function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const initialQ = params.get("q") ?? "";
  const [input, setInput] = useState(initialQ);
  const [query, setQuery] = useState(initialQ);
  const [tab, setTab] = useState<Tab>("all");

  // Keep the box in sync when navigating in with a ?q= from elsewhere.
  // Adjusting state during render (rather than in an effect) is React's
  // recommended way to react to a changed prop — it re-renders before paint
  // instead of causing a second, visible pass.
  const [lastQ, setLastQ] = useState(initialQ);
  if (initialQ !== lastQ) {
    setLastQ(initialQ);
    setInput(initialQ);
    setQuery(initialQ);
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["search", query],
    queryFn: () => searchAll(query),
    enabled: query.trim().length > 0,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    setQuery(q);
    router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  const peaks = data?.peaks ?? [];
  const routes = data?.routes ?? [];
  const place = data?.place ?? null;
  const showPeaks = tab === "all" || tab === "peaks";
  const showTrails = tab === "all" || tab === "trails";
  const nothing =
    query.trim().length > 0 && !isLoading && peaks.length === 0 && routes.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 md:pt-24">
      <h1 className="mb-1 font-display text-2xl font-bold text-ink">Search a mountain</h1>
      <p className="mb-5 text-sm text-ink-muted">
        Type any mountain — like Mount Rainier — to see every peak and trail around it.
      </p>

      <form onSubmit={submit} className="relative mb-6">
        <svg
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.2-5.2m0 0A7.5 7.5 0 105.2 5.2a7.5 7.5 0 0010.6 10.6z" />
        </svg>
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search a mountain — e.g. Mount Rainier, Mount Shasta…"
          className="w-full rounded-2xl border border-border bg-surface py-3.5 pl-12 pr-4 text-ink placeholder:text-ink-faint focus:border-border-bright focus:outline-none focus:ring-2 focus:ring-trail-500/30"
        />
      </form>

      {place && (peaks.length > 0 || routes.length > 0) && (
        <div className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-pine-200 bg-pine-50 px-4 py-3 text-sm">
          <span className="font-semibold text-pine-700">📍 {place.name}</span>
          <span className="text-ink-muted">
            — {peaks.length} peak{peaks.length === 1 ? "" : "s"} and {routes.length} trail
            {routes.length === 1 ? "" : "s"} around here
          </span>
        </div>
      )}

      {query.trim().length > 0 && (
        <div className="mb-6 flex gap-2">
          {([
            ["all", `All${data ? ` (${peaks.length + routes.length})` : ""}`],
            ["peaks", `Peaks${data ? ` (${peaks.length})` : ""}`],
            ["trails", `Trails${data ? ` (${routes.length})` : ""}`],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                tab === key
                  ? "bg-trail-500 text-white"
                  : "bg-surface text-ink-muted hover:bg-surface-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {isLoading && query.trim().length > 0 && (
        <div className="py-16 text-center text-ink-muted">Searching…</div>
      )}

      {query.trim().length === 0 && (
        <div className="py-16 text-center text-ink-faint">
          Start typing to search across every peak and trail.
        </div>
      )}

      {nothing && (
        <div className="py-16 text-center text-ink-muted">
          No peaks or trails match &ldquo;{query}&rdquo;.
        </div>
      )}

      {showPeaks && peaks.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
            <span>⛰</span> Peaks
            <span className="font-mono text-sm font-normal text-ink-faint">{peaks.length}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {peaks.map((p) => (
              <PeakCard key={p.id} peak={p} trailCount={p.trail_count} />
            ))}
          </div>
        </section>
      )}

      {showTrails && routes.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
            <span>🥾</span> Trails
            <span className="font-mono text-sm font-normal text-ink-faint">{routes.length}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {routes.map((r) => (
              <RouteCard key={r.id} route={r} />
            ))}
          </div>
        </section>
      )}

      {isFetching && !isLoading && (
        <div className="py-2 text-center text-xs text-ink-faint">Updating…</div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="py-24 text-center text-ink-muted">Loading…</div>}>
      <SearchResults />
    </Suspense>
  );
}

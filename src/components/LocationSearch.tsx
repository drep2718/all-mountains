"use client";

import { useState, useEffect, useRef } from "react";
import { geocode, type GeocodeResult } from "@/lib/geocode";
import { searchPeaksByName } from "@/lib/search";

interface Props {
  onSelect: (place: GeocodeResult | null) => void;
  selected: GeocodeResult | null;
  placeholder?: string;
}

// A result row is either a peak (fly to the summit) or a geocoded place.
type Row =
  | { kind: "peak"; place: GeocodeResult; elevation: number | null }
  | { kind: "place"; place: GeocodeResult };

// A small box around a peak so it both flies the map there and, on list pages,
// acts as an "area near this peak" filter.
const PEAK_SPAN = 0.15;

export default function LocationSearch({ onSelect, selected, placeholder = "Search a mountain or place..." }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Whether results are shown is derived from the query, so no effect needs to
  // clear them when the box is emptied.
  const visible = query.trim().length >= 2 ? results : [];

  useEffect(() => {
    if (!query || query.length < 2) return;
    const t = setTimeout(async () => {
      setLoading(true);
      // Peaks and places in parallel; peaks first since a typed name is usually a summit.
      const [peaks, places] = await Promise.all([searchPeaksByName(query), geocode(query)]);
      const peakRows: Row[] = peaks
        .filter((p) => p.name)
        .slice(0, 4)
        .map((p) => ({
          kind: "peak",
          elevation: p.elevation,
          place: {
            name: p.name as string,
            center: [p.longitude, p.latitude],
            bbox: [p.longitude - PEAK_SPAN, p.latitude - PEAK_SPAN, p.longitude + PEAK_SPAN, p.latitude + PEAK_SPAN],
          },
        }));
      // Drop geocoded places that just repeat a peak we're already showing, then
      // keep the list short so the dropdown never feels cluttered.
      const peakNames = new Set(peakRows.map((r) => r.place.name.toLowerCase()));
      const placeRows: Row[] = places
        .filter((pl) => !peakNames.has(pl.name.split(",")[0].trim().toLowerCase()))
        .map((pl) => ({ kind: "place", place: pl }));
      setResults([...peakRows, ...placeRows].slice(0, 6));
      setLoading(false);
      setOpen(true);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-pine-500 bg-pine-500/10 px-3 py-2.5 text-sm">
        <svg className="h-4 w-4 flex-shrink-0 text-pine-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-ink">{selected.name}</span>
        <button onClick={() => { onSelect(null); setQuery(""); }} className="flex-shrink-0 text-ink-muted hover:text-ink">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
      </svg>
      <input
        type="text" value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => visible.length && setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-ink placeholder-ink-faint outline-none focus:border-pine-500"
      />
      {open && (query.length >= 2) && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          {loading ? (
            <div className="px-4 py-3 text-sm text-ink-faint">Searching...</div>
          ) : visible.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-faint">No mountains or places found</div>
          ) : (
            visible.map((r, i) => (
              <button key={`${r.kind}-${r.place.name}-${i}`}
                onClick={() => { onSelect(r.place); setOpen(false); setQuery(""); }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-ink transition-colors hover:bg-surface-2">
                {r.kind === "peak" ? (
                  <svg className="h-4 w-4 flex-shrink-0 text-pine-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 20l5.5-11L12 14l3-6 6 12H3z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 flex-shrink-0 text-ink-faint" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                )}
                <span className="truncate">{r.place.name}</span>
                {r.kind === "peak" && r.elevation != null && (
                  <span className="ml-auto flex-shrink-0 font-mono text-xs text-ink-faint">{r.elevation.toLocaleString()}m</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import { geocode, type GeocodeResult } from "@/lib/geocode";

interface Props {
  onSelect: (place: GeocodeResult | null) => void;
  selected: GeocodeResult | null;
  placeholder?: string;
}

export default function LocationSearch({ onSelect, selected, placeholder = "Enter a town or state..." }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      setResults(await geocode(query));
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
        <svg className="h-4 w-4 flex-shrink-0 text-pine-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
        onFocus={() => results.length && setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-surface py-2.5 pl-10 pr-4 text-sm text-ink placeholder-ink-faint outline-none focus:border-pine-500"
      />
      {open && (query.length >= 2) && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
          {loading ? (
            <div className="px-4 py-3 text-sm text-ink-faint">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-faint">No places found</div>
          ) : (
            results.map((r) => (
              <button key={r.name}
                onClick={() => { onSelect(r); setOpen(false); setQuery(""); }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-ink transition-colors hover:bg-surface-2">
                <svg className="h-4 w-4 flex-shrink-0 text-ink-faint" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                <span className="truncate">{r.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Route, Difficulty } from "@/lib/types";
import {
  DIFFICULTY_HEX,
  getDifficultyColor,
  NETWORK_LABEL,
  formatDuration,
} from "@/lib/types";

// Rank difficulty text → number for sorting (unknown sorts last)
const DIFF_RANK: Record<string, number> = {
  Easy: 0,
  Moderate: 1,
  Hard: 2,
  Expert: 3,
  Extreme: 4,
};

type SortKey = "common-asc" | "common-desc" | "diff-asc" | "diff-desc";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "common-asc", label: "Least common" },
  { key: "common-desc", label: "Most common" },
  { key: "diff-asc", label: "Easiest" },
  { key: "diff-desc", label: "Hardest" },
];

/**
 * All trails that summit a given peak, sortable by "commonality" (how many peaks
 * the trail connects) or difficulty. The junction (route_peaks) is populated by
 * the link_route_peaks() spatial RPC — this just reads the reverse direction.
 */
export default function TrailsForPeak({ peakId }: { peakId: number }) {
  const supabase = createClient();
  const [sort, setSort] = useState<SortKey>("common-asc");

  const { data: trails, isLoading } = useQuery({
    queryKey: ["peak-trails", peakId],
    queryFn: async (): Promise<Route[]> => {
      // 1. Reverse of routes/[id]: every route linked to this peak
      const { data: links } = await supabase
        .from("route_peaks")
        .select("routes(*)")
        .eq("peak_id", peakId);

      const routes = ((links ?? []) as unknown as { routes: Route | null }[])
        .map((l) => l.routes)
        .filter((r): r is Route => !!r);

      if (routes.length === 0) return [];

      // 2. Commonality = how many peaks each of those trails connects.
      //    One extra query, tallied client-side — no new RPC needed.
      const ids = routes.map((r) => r.id);
      const { data: allLinks } = await supabase
        .from("route_peaks")
        .select("route_id")
        .in("route_id", ids);

      const counts = new Map<number, number>();
      for (const row of allLinks ?? []) {
        counts.set(row.route_id, (counts.get(row.route_id) ?? 0) + 1);
      }
      return routes.map((r) => ({ ...r, peak_count: counts.get(r.id) ?? 1 }));
    },
    staleTime: 30 * 60 * 1000,
  });

  const sorted = [...(trails ?? [])].sort((a, b) => {
    switch (sort) {
      case "common-asc":
        return (a.peak_count ?? 0) - (b.peak_count ?? 0);
      case "common-desc":
        return (b.peak_count ?? 0) - (a.peak_count ?? 0);
      case "diff-asc":
        return (DIFF_RANK[a.difficulty ?? ""] ?? 99) - (DIFF_RANK[b.difficulty ?? ""] ?? 99);
      case "diff-desc":
        return (DIFF_RANK[b.difficulty ?? ""] ?? -1) - (DIFF_RANK[a.difficulty ?? ""] ?? -1);
    }
  });

  if (isLoading) {
    return (
      <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
        <div className="h-5 w-40 animate-pulse rounded bg-border" />
      </div>
    );
  }

  if (!trails || trails.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink">
          Trails to this summit
          <span className="ml-2 text-sm font-normal text-ink-faint">{trails.length}</span>
        </h2>
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-faint">Sort</label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-ground px-2.5 py-1.5 text-xs font-medium text-ink outline-none focus:border-pine-600"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <ul className="divide-y divide-border">
        {sorted.map((t) => {
          const diff = (t.difficulty as Difficulty) || null;
          return (
            <li key={t.id}>
              <Link
                href={`/routes/${t.id}`}
                className="flex items-center gap-3 py-3 transition-colors hover:bg-ground/60"
              >
                <span
                  className="h-9 w-1.5 flex-none rounded-full"
                  style={{ background: DIFFICULTY_HEX[diff as Difficulty] ?? "#8a8a80" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">
                    {t.name || "Unnamed trail"}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
                    {t.distance_km != null && <span>{t.distance_km.toFixed(1)} km</span>}
                    {t.est_time_min != null && <span>· {formatDuration(t.est_time_min)}</span>}
                    {t.route_type && <span>· {t.route_type}</span>}
                    {t.network && NETWORK_LABEL[t.network] && (
                      <span>· {NETWORK_LABEL[t.network]}</span>
                    )}
                    <span>· connects {t.peak_count} peak{t.peak_count === 1 ? "" : "s"}</span>
                  </div>
                </div>
                {diff && (
                  <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-medium ${getDifficultyColor(diff)}`}>
                    {diff}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

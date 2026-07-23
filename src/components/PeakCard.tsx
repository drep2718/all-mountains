import Link from "next/link";
import { type Peak, getDifficulty, getDifficultyColor } from "@/lib/types";
import { peakImageUrl } from "@/lib/peakImage";

export default function PeakCard({
  peak,
  distance,
  trailCount,
}: {
  peak: Peak;
  distance?: number;
  trailCount?: number;
}) {
  const difficulty = getDifficulty(peak.elevation);
  const imageUrl = peakImageUrl(peak);

  return (
    <Link
      href={`/peaks/${peak.id}`}
      className="group overflow-hidden rounded-2xl border border-border bg-surface transition-all hover:border-border-bright hover:shadow-xl hover:shadow-black/40"
    >
      <div className="topo-texture relative h-40 overflow-hidden bg-surface-2">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={peak.name || "Peak"}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-surface-2 to-surface-3">
            <span className="text-5xl opacity-25">⛰</span>
          </div>
        )}
        {peak.is_iconic && (
          <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-[#e8b33a] px-2.5 py-0.5 text-xs font-bold text-[#3d2c00] shadow-lg">
            🥇 Iconic
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface via-surface/70 to-transparent p-3 pt-10">
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${getDifficultyColor(difficulty)}`}>
            {difficulty}
          </span>
        </div>
      </div>

      <div className="p-4">
        <h3 className="truncate font-display text-lg font-bold text-ink">
          {peak.name || "Unnamed Peak"}
        </h3>
        <div className="mt-0.5 text-sm text-ink-muted">
          {peak.country}
          {peak.region && ` · ${peak.region}`}
        </div>

        <div className="mt-3 flex items-center gap-4 text-sm">
          {peak.elevation && (
            <div className="flex items-center gap-1.5">
              <svg className="h-4 w-4 text-pine-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 20l5.5-11L12 14l3-6 6 12H3z" />
              </svg>
              <span className="font-mono font-semibold text-ink">{peak.elevation.toLocaleString()}m</span>
            </div>
          )}
          {peak.prominence && (
            <div className="font-mono text-ink-faint">{peak.prominence.toLocaleString()}m prom</div>
          )}
          {distance !== undefined && (
            <div className="ml-auto font-mono text-ink-faint">
              {distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)}km`}
            </div>
          )}
        </div>

        {trailCount !== undefined && (
          <div className="mt-3 border-t border-border pt-2.5 text-sm font-medium text-trail-500">
            {trailCount > 0
              ? `${trailCount} trail${trailCount === 1 ? "" : "s"} to this summit →`
              : "No mapped trails yet"}
          </div>
        )}
      </div>
    </Link>
  );
}

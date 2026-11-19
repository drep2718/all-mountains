import Link from "next/link";
import {
  CATEGORY_LABEL,
  DIFFICULTY_LABEL,
  difficultyClasses,
  type Peak,
} from "@/lib/peak-types";

/** Falls back to a satellite view so every card shows a mountain. */
function cardImage(peak: Peak): string | null {
  if (peak.hero_photo_url) return peak.hero_photo_url;
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  return (
    `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/` +
    `${peak.longitude},${peak.latitude},12.5,0/640x400@2x?access_token=${token}`
  );
}

export default function PeakCard({
  peak,
  distance,
  summited,
}: {
  peak: Peak;
  distance?: number;
  summited?: boolean;
}) {
  const imageUrl = cardImage(peak);

  return (
    <Link
      href={`/peaks/${peak.slug}`}
      className="group overflow-hidden rounded-2xl border border-border bg-surface transition-all hover:border-border-bright hover:shadow-xl hover:shadow-black/40"
    >
      <div className="topo-texture relative h-40 overflow-hidden bg-surface-2">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={peak.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-surface-2 to-surface-3">
            <span className="text-5xl opacity-25">⛰</span>
          </div>
        )}

        <div className="absolute right-3 top-3 flex gap-1.5">
          {summited && (
            <span className="rounded-full bg-[#e8b33a] px-2.5 py-0.5 text-xs font-bold text-[#3d2c00] shadow-lg">
              ✓ Summited
            </span>
          )}
          {peak.category === "highpoint" && !summited && (
            <span className="rounded-full bg-[#e8b33a] px-2.5 py-0.5 text-xs font-bold text-[#3d2c00] shadow-lg">
              🥇 {CATEGORY_LABEL.highpoint}
            </span>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface via-surface/70 to-transparent p-3 pt-10">
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${difficultyClasses(peak.difficulty)}`}
          >
            {DIFFICULTY_LABEL[peak.difficulty]}
          </span>
        </div>
      </div>

      <div className="p-4">
        <h3 className="truncate font-display text-lg font-bold text-ink">{peak.name}</h3>
        <div className="mt-0.5 truncate text-sm text-ink-muted">
          {[peak.range_name, peak.region, peak.country].filter(Boolean).join(" · ")}
        </div>

        <div className="mt-3 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <svg
              className="h-4 w-4 text-pine-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 20l5.5-11L12 14l3-6 6 12H3z" />
            </svg>
            <span className="font-mono font-semibold text-ink">
              {peak.elevation_m.toLocaleString()}m
            </span>
          </div>
          {peak.prominence_m ? (
            <div className="font-mono text-ink-faint">
              {peak.prominence_m.toLocaleString()}m prom
            </div>
          ) : null}
          {distance !== undefined && (
            <div className="ml-auto font-mono text-ink-faint">
              {distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)}km`}
            </div>
          )}
        </div>

        {peak.route_count !== undefined && (
          <div className="mt-3 border-t border-border pt-2.5 text-sm font-medium text-trail-500">
            {peak.route_count > 0
              ? `${peak.route_count} route${peak.route_count === 1 ? "" : "s"} to this summit →`
              : peak.difficulty === "technical"
                ? "A climb — no walking trail"
                : "No mapped trail yet"}
          </div>
        )}
      </div>
    </Link>
  );
}

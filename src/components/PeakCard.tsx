import Link from "next/link";
import {
  CATEGORY_LABEL,
  DIFFICULTY_DOT,
  DIFFICULTY_LABEL,
  type Peak,
} from "@/lib/peak-types";
import { commonsWidth } from "@/lib/commons";

/** Falls back to a satellite view so every card shows a mountain. */
function cardImage(peak: Peak): string | null {
  // 500 px, not the stored 1,280: this is a card, and a grid of them was
  // pulling two dozen full-size photographs to fill 300 px boxes.
  if (peak.hero_photo_url) return commonsWidth(peak.hero_photo_url, 500);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  return (
    `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/` +
    `${peak.longitude},${peak.latitude},12.5,0/480x360@2x?access_token=${token}`
  );
}

/**
 * A peak in a grid, in the shape AllTrails uses for a trail.
 *
 * The change from the previous card is mostly subtraction. It was a
 * bordered panel with a shadow, a gradient scrim, a badge floating over
 * the photo, and the facts spread across three rows separated by rules.
 * The version here is an image and three lines of text on the page
 * itself: no border, no shadow, no scrim, and one metadata row with
 * middots. The photograph is doing the work either way, and the frame
 * around it was competing with the mountain in it.
 *
 * The single row also forces the facts into priority order — height,
 * grade, prominence, routes — instead of letting each one claim its own
 * line and implying they matter equally.
 */
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
  const place = [peak.range_name, peak.region ?? peak.country].filter(Boolean).join(" · ");

  return (
    <Link href={`/peaks/${peak.slug}`} className="group block">
      <div className="topo-texture relative aspect-[4/3] overflow-hidden rounded-xl bg-surface-2">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={peak.name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-surface-2 to-surface-3">
            <span className="text-5xl opacity-25">⛰</span>
          </div>
        )}

        {(summited || peak.category === "highpoint") && (
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-ink shadow-sm">
            {summited ? "✓ Summited" : `🥇 ${CATEGORY_LABEL.highpoint}`}
          </span>
        )}
      </div>

      <h3 className="mt-2.5 truncate font-semibold leading-snug text-ink group-hover:underline">
        {peak.name}
      </h3>
      {place && <p className="truncate text-sm text-ink-muted">{place}</p>}

      {/* One row, middot-separated — the AllTrails metadata line. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-ink-muted">
        <span className="font-medium text-ink">{peak.elevation_m.toLocaleString()} m</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${DIFFICULTY_DOT[peak.difficulty]}`} />
          {DIFFICULTY_LABEL[peak.difficulty]}
        </span>
        {peak.prominence_m ? (
          <>
            <span aria-hidden>·</span>
            <span>{peak.prominence_m.toLocaleString()} m prom</span>
          </>
        ) : null}
        {peak.route_count ? (
          <>
            <span aria-hidden>·</span>
            <span>
              {peak.route_count} route{peak.route_count === 1 ? "" : "s"}
            </span>
          </>
        ) : null}
        {distance !== undefined && (
          <>
            <span aria-hidden>·</span>
            <span>{distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km away`}</span>
          </>
        )}
      </div>
    </Link>
  );
}

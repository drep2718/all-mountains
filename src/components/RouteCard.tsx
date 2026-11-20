import Link from "next/link";
import { type PeakRoute as Route, formatEstimate } from "@/lib/peak-types";
import { routeStaticMapUrl } from "@/lib/staticMap";
import { describeSummitGap } from "@/lib/summit-gap";
import { describeTripDistance, tripFigures } from "@/lib/trip";

export default function RouteCard({
  route,
  peakName,
  summitElevationM,
}: {
  route: Route;
  /** The summit this route serves — a route has exactly one now. */
  peakName?: string;
  /** Lets the card say how far *below* the top a route stops, not just how far from it. */
  summitElevationM?: number | null;
}) {
  const mapUrl = routeStaticMapUrl(route, 640, 360);
  // The whole trip. The stored distance is the one-way line.
  const trip = tripFigures({
    routeType: route.route_type,
    distanceKm: route.distance_km,
    ascentM: route.ascent_m,
    descentM: route.descent_m,
    storedMinutes: route.est_time_min,
    difficulty: (route.difficulty ?? "hike") as "hike" | "scramble" | "technical",
  });
  const tripDistance = describeTripDistance(trip);
  const gap = describeSummitGap({
    isSummitRoute: route.is_summit_route,
    distanceToSummitM: route.distance_to_summit_m,
    highPointM: route.high_point_m,
    summitElevationM: summitElevationM ?? null,
  });

  return (
    <Link
      href={`/routes/${route.id}`}
      className="group overflow-hidden rounded-2xl border border-border bg-surface transition-all hover:border-border-bright hover:shadow-xl hover:shadow-black/40"
    >
      {/* Map-image thumbnail of the actual route */}
      <div className="relative h-44 overflow-hidden bg-surface-2">
        {mapUrl ? (
          <img
            src={mapUrl}
            alt={`Map of ${route.name}`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl opacity-30">🥾</div>
        )}
        <div className="absolute left-3 top-3 flex gap-1.5">
          {route.difficulty && (
            <span className="rounded-full bg-ground/85 px-2.5 py-1 text-xs font-semibold text-trail-500 backdrop-blur">
              {route.difficulty}
            </span>
          )}
          {route.route_type && (
            <span className="rounded-full bg-ground/85 px-2.5 py-1 text-xs font-medium text-ink backdrop-blur">
              {route.route_type}
            </span>
          )}
        </div>
      </div>

      <div className="p-4">
        <h3 className="truncate font-display text-lg font-bold text-ink">
          {route.name || "Unnamed Route"}
        </h3>
        <div className="mt-0.5 truncate text-sm text-ink-muted">
          {peakName ? `to ${peakName}` : route.ref ? `Route ${route.ref}` : ""}
        </div>

        {/* Stat row — AllTrails style */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm">
          {trip.distanceKm != null && (
            <span className="text-ink">
              <span className="text-ink-faint">↔</span> {tripDistance.primary}
            </span>
          )}
          {tripDistance.secondary && (
            <span className="text-ink-faint">{tripDistance.secondary}</span>
          )}
          {trip.minutes != null && (
            <span className="text-ink">
              <span className="text-ink-faint">⏱</span> {formatEstimate(trip.minutes)}
            </span>
          )}
          {trip.ascentM != null && (
            <span className="text-ink">
              <span className="text-ink-faint">▲</span> {trip.ascentM.toLocaleString()} m
            </span>
          )}
          {route.is_summit_route ? (
            <span className="text-pine-600">reaches the summit</span>
          ) : gap ? (
            <span className="text-ink-faint" title={gap.detail}>
              {gap.label}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

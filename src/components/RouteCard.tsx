import Link from "next/link";
import { type Route, formatDuration } from "@/lib/types";
import { routeStaticMapUrl } from "@/lib/staticMap";

export default function RouteCard({ route }: { route: Route }) {
  const mapUrl = routeStaticMapUrl(route, 640, 360);

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
        <div className="mt-0.5 text-sm text-ink-muted">
          {route.region ? `${route.region}, ` : ""}{route.country}
        </div>

        {/* Stat row — AllTrails style */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm">
          {route.distance_km != null && (
            <span className="text-ink">
              <span className="text-ink-faint">↔</span> {route.distance_km.toFixed(1)} km
            </span>
          )}
          {route.est_time_min != null && (
            <span className="text-ink">
              <span className="text-ink-faint">⏱</span> {formatDuration(route.est_time_min)}
            </span>
          )}
          {route.ascent_m != null && (
            <span className="text-ink">
              <span className="text-ink-faint">▲</span> {route.ascent_m.toLocaleString()} m
            </span>
          )}
          {route.peak_count ? (
            <span className="text-pine-400">
              {route.peak_count} peak{route.peak_count === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

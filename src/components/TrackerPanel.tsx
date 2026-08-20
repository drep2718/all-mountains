"use client";

import { formatDuration, formatPace, type TrackStats } from "@/lib/track";
import type { GpsError, TrackerStatus } from "@/hooks/useTracker";

const GPS_MESSAGES: Record<string, string> = {
  denied: "Location permission denied. Enable it in your browser settings to record.",
  unavailable: "No GPS signal. Move to open sky — recording continues when a fix returns.",
  timeout: "Waiting for GPS… still trying.",
  unsupported: "This device or browser can't provide location.",
};

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-3 py-3 text-center">
      <div className={`font-mono text-xl font-bold ${accent ? "text-pine-600" : "text-ink"}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  );
}

interface Props {
  status: TrackerStatus;
  stats: TrackStats;
  error: GpsError;
  accuracy: number | null;
  recovered: boolean;
  isOffRoute: boolean;
  offRouteM: number | null;
  pointCount: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onDiscard: () => void;
}

export default function TrackerPanel({
  status, stats, error, accuracy, recovered, isOffRoute, offRouteM,
  pointCount, onStart, onPause, onResume, onFinish, onDiscard,
}: Props) {
  const recording = status === "recording";

  return (
    <div className="space-y-3">
      {recovered && (
        <div className="rounded-2xl border border-trail-500/40 bg-trail-500/10 px-4 py-3 text-sm text-ink">
          <span className="font-semibold">Recording recovered.</span> Your hike was
          interrupted — {pointCount} points restored. Resume to keep going.
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-diff-extreme/40 bg-diff-extreme/10 px-4 py-3 text-sm text-diff-extreme">
          {GPS_MESSAGES[error.kind]}
        </div>
      )}

      {isOffRoute && (
        <div className="rounded-2xl border-2 border-diff-extreme bg-diff-extreme/15 px-4 py-3 text-sm font-semibold text-diff-extreme">
          ⚠️ Off trail — about {Math.round(offRouteM ?? 0)} m from the route. Turn back
          to rejoin it.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Distance" value={`${stats.distanceKm.toFixed(2)} km`} accent />
        <Stat label="Time" value={formatDuration(stats.elapsedSeconds)} />
        <Stat label="Ascent" value={`${Math.round(stats.ascentM)} m`} />
        <Stat label="Pace" value={formatPace(stats.avgPaceMinPerKm)} />
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-ink-faint">
        <span>
          {recording ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-diff-extreme" />
              Recording · {pointCount} pts
            </span>
          ) : status === "paused" ? (
            `Paused · ${pointCount} pts`
          ) : (
            "Ready"
          )}
        </span>
        <span>
          {accuracy != null ? `GPS ±${Math.round(accuracy)} m` : "Acquiring GPS…"}
        </span>
      </div>

      <div className="flex gap-2">
        {status === "idle" && (
          <button
            onClick={onStart}
            className="flex-1 rounded-2xl bg-pine-600 py-4 text-base font-bold text-white transition-colors hover:bg-pine-700"
          >
            ▶ Start recording
          </button>
        )}

        {recording && (
          <>
            <button
              onClick={onPause}
              className="flex-1 rounded-2xl border border-border bg-surface py-4 text-base font-bold text-ink transition-colors hover:bg-ground"
            >
              ‖ Pause
            </button>
            <button
              onClick={onFinish}
              className="flex-1 rounded-2xl bg-trail-600 py-4 text-base font-bold text-white transition-colors hover:bg-trail-500"
            >
              ■ Finish
            </button>
          </>
        )}

        {status === "paused" && (
          <>
            <button
              onClick={onResume}
              className="flex-1 rounded-2xl bg-pine-600 py-4 text-base font-bold text-white transition-colors hover:bg-pine-700"
            >
              ▶ Resume
            </button>
            <button
              onClick={onFinish}
              className="flex-1 rounded-2xl bg-trail-600 py-4 text-base font-bold text-white transition-colors hover:bg-trail-500"
            >
              ■ Finish
            </button>
            <button
              onClick={onDiscard}
              className="rounded-2xl border border-border px-4 py-4 text-sm font-semibold text-ink-muted transition-colors hover:text-diff-extreme"
            >
              Discard
            </button>
          </>
        )}
      </div>
    </div>
  );
}

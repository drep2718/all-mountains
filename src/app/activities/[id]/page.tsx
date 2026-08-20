"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { deleteActivity, getActivity, type Activity } from "@/lib/trackStore";
import { computeStats, formatDuration, formatPace, toGPX } from "@/lib/track";
import { useLocalStore, notifyLocalStore } from "@/hooks/useLocalStore";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-3 py-3 text-center">
      <div className="font-mono text-lg font-bold text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  );
}

export default function ActivityDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const read = useCallback(() => getActivity(String(id)), [id]);
  const activity = useLocalStore<Activity | null>(read, null);

  if (activity === null) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <p className="text-ink-muted">That activity isn&rsquo;t on this device.</p>
        <Link href="/activities" className="mt-4 inline-block text-sm font-semibold text-pine-600">
          ← All activities
        </Link>
      </div>
    );
  }

  const stats = computeStats(activity.points);

  function exportGpx() {
    const a = activity!;
    const blob = new Blob([toGPX(a.name, a.points)], {
      type: "application/gpx+xml",
    });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = `${a.name.replace(/[^\w-]+/g, "-").toLowerCase()}.gpx`;
    document.body.appendChild(el);
    el.click();
    el.remove();
    URL.revokeObjectURL(url);
  }

  function remove() {
    if (!confirm("Delete this activity? This can't be undone.")) return;
    deleteActivity(String(id));
    notifyLocalStore();
    router.push("/activities");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 md:pt-24">
      <Link href="/activities" className="mb-4 inline-block text-sm text-ink-muted hover:text-ink">
        ← All activities
      </Link>

      <h1 className="font-display text-2xl font-bold text-ink">{activity.name}</h1>
      <p className="mb-5 mt-1 text-sm text-ink-muted">
        {new Date(activity.startedAt).toLocaleString(undefined, {
          weekday: "short", month: "short", day: "numeric",
          year: "numeric", hour: "numeric", minute: "2-digit",
        })}
      </p>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Distance" value={`${activity.distanceKm.toFixed(2)} km`} />
        <Stat label="Moving" value={formatDuration(activity.movingSeconds)} />
        <Stat label="Ascent" value={`${Math.round(activity.ascentM)} m`} />
        <Stat label="Pace" value={formatPace(stats.avgPaceMinPerKm)} />
      </div>

      <p className="mb-5 text-xs text-ink-faint">
        {activity.points.length} GPS points · descent {Math.round(activity.descentM)} m
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={exportGpx}
          className="flex-1 rounded-2xl border border-border bg-surface py-3 text-sm font-semibold text-ink transition-colors hover:bg-ground"
        >
          ⤓ Export GPX
        </button>
        {activity.routeId && (
          <Link
            href={`/routes/${activity.routeId}`}
            className="flex-1 rounded-2xl border border-border bg-surface py-3 text-center text-sm font-semibold text-ink transition-colors hover:bg-ground"
          >
            View trail
          </Link>
        )}
        <button
          onClick={remove}
          className="rounded-2xl border border-border px-4 py-3 text-sm font-semibold text-ink-muted transition-colors hover:text-diff-extreme"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

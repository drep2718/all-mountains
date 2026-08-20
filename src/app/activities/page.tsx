"use client";

import Link from "next/link";
import { listActivities, type Activity } from "@/lib/trackStore";
import { formatDuration } from "@/lib/track";
import { useLocalStore } from "@/hooks/useLocalStore";

const EMPTY: Activity[] = [];

export default function ActivitiesPage() {
  // Server renders the empty state; the device's list streams in on hydration.
  const items = useLocalStore(listActivities, EMPTY);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 md:pt-24">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">My activities</h1>
          <p className="mt-1 text-sm text-ink-muted">Hikes recorded on this device.</p>
        </div>
        <Link
          href="/record"
          className="flex-none rounded-xl bg-pine-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-pine-700"
        >
          + Record
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-ink-faint">
          No recorded hikes yet. Tap <span className="font-semibold text-ink">Record</span> to
          track your first one.
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {items.map((a) => (
            <li key={a.id}>
              <Link href={`/activities/${a.id}`} className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-ground">
                <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-pine-600/15 text-xl">
                  🥾
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{a.name}</div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {new Date(a.startedAt).toLocaleDateString(undefined, {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                  </div>
                </div>
                <div className="flex-none text-right">
                  <div className="font-mono text-sm font-semibold text-pine-600">
                    {a.distanceKm.toFixed(2)} km
                  </div>
                  <div className="text-xs text-ink-faint">
                    {formatDuration(a.movingSeconds)} · {Math.round(a.ascentM)} m ↑
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

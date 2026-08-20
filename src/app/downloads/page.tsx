"use client";

import Link from "next/link";
import {
  formatBytes, listDownloads, removeDownload, totalDownloadedBytes,
  type DownloadedTrail,
} from "@/lib/offline";
import { useLocalStore, notifyLocalStore } from "@/hooks/useLocalStore";

const EMPTY: DownloadedTrail[] = [];

export default function DownloadsPage() {
  const items = useLocalStore(listDownloads, EMPTY);

  async function remove(routeId: number) {
    await removeDownload(routeId);
    notifyLocalStore();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 md:pt-24">
      <h1 className="font-display text-2xl font-bold text-ink">Offline downloads</h1>
      <p className="mb-6 mt-1 text-sm text-ink-muted">
        Trails saved to this device with their maps — usable with no signal.
        {items.length > 0 && ` Using ${formatBytes(totalDownloadedBytes())}.`}
      </p>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-ink-faint">
          Nothing downloaded yet. Open a trail and tap{" "}
          <span className="font-semibold text-ink">Download for offline</span> before you
          lose signal.
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {items.map((d) => (
            <li key={d.routeId} className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-pine-600/15 text-xl">
                🗺️
              </div>
              <Link href={`/routes/${d.routeId}`} className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{d.name}</div>
                <div className="mt-0.5 text-xs text-ink-muted">
                  {d.tileCount} tiles · {formatBytes(d.bytes)} ·{" "}
                  {new Date(d.downloadedAt).toLocaleDateString()}
                </div>
              </Link>
              <button
                onClick={() => remove(d.routeId)}
                className="flex-none rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:text-diff-extreme"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

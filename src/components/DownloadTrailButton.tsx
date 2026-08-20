"use client";

import { useCallback, useState } from "react";
import {
  downloadTrail, estimateLabel, formatBytes, getDownload, removeDownload,
  type DownloadProgress, type DownloadedTrail,
} from "@/lib/offline";
import { useLocalStore, notifyLocalStore } from "@/hooks/useLocalStore";
import type { Route } from "@/lib/types";

export default function DownloadTrailButton({ route }: { route: Route }) {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(() => getDownload(route.id), [route.id]);
  const entry = useLocalStore<DownloadedTrail | null>(read, null);

  const bbox = {
    minLng: route.bbox_min_lng, minLat: route.bbox_min_lat,
    maxLng: route.bbox_max_lng, maxLat: route.bbox_max_lat,
  };

  const busy = progress !== null;
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  async function start() {
    setError(null);
    setProgress({ done: 0, total: 1, bytes: 0 });
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setError("Map token missing — can't download tiles.");
      setProgress(null);
      return;
    }
    try {
      await downloadTrail(
        { id: route.id, name: route.name },
        bbox,
        token,
        route,           // the trail itself, so the page works with no network
        (p) => setProgress(p)
      );
      notifyLocalStore();
    } catch {
      setError("Download failed. Check your connection and try again.");
    } finally {
      setProgress(null);
    }
  }

  async function remove() {
    await removeDownload(route.id);
    notifyLocalStore();
  }

  if (entry) {
    return (
      <div className="rounded-2xl border border-pine-600 bg-pine-600/10 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-pine-700">✓ Available offline</div>
            <div className="text-xs text-ink-muted">
              {entry.tileCount} map tiles · {formatBytes(entry.bytes)}
            </div>
          </div>
          <button
            onClick={remove}
            className="flex-none rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:text-diff-extreme"
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={start}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface py-3 text-sm font-semibold text-ink transition-colors hover:bg-ground disabled:opacity-60"
      >
        {busy ? `Downloading… ${pct}%` : `⤓ Download for offline (~${estimateLabel(bbox)})`}
      </button>

      {busy && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-pine-600 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {busy && progress && (
        <p className="mt-1 text-center text-xs text-ink-faint">
          {progress.done} / {progress.total} tiles
          {progress.bytes > 0 && ` · ${formatBytes(progress.bytes)}`}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-diff-extreme">{error}</p>}
    </div>
  );
}

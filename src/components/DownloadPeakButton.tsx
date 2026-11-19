"use client";

import { useCallback, useState } from "react";
import {
  downloadPeak,
  estimatePeakDownload,
  formatBytes,
  getPeakDownload,
  removePeakDownload,
  type DownloadedPeak,
} from "@/lib/offline";
import type { Peak, PeakPhoto, PeakRoute } from "@/lib/peak-types";
import { useLocalStore, notifyLocalStore } from "@/hooks/useLocalStore";

/**
 * "Download this mountain" — the peak, its routes, the map around them, and
 * the photographs, all usable with no signal.
 *
 * The estimate is shown before committing. A download that silently turns out
 * to be 130 MB on a phone at a trailhead is a bug, not a feature.
 */

/** Refuse to start past this without an explicit second tap. */
const WARN_BYTES = 75 * 1024 * 1024;

export default function DownloadPeakButton({
  peak,
  routes,
  photos,
}: {
  peak: Peak;
  routes: PeakRoute[];
  photos: PeakPhoto[];
}) {
  // The download index lives in localStorage, which is an external store.
  // Copying it into state inside an effect causes a cascading render and a
  // hydration mismatch; subscribing to it does neither.
  const read = useCallback(() => getPeakDownload(peak.slug), [peak.slug]);
  const saved = useLocalStore<DownloadedPeak | null>(read, null);
  const [busy, setBusy] = useState(false);
  const [confirmBig, setConfirmBig] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const photoUrls = photos.map((p) => p.url);
  const routePolys = routes.map((r) => r.poly);
  const estimate = estimatePeakDownload({
    routePolys,
    photoUrls,
    latitude: peak.latitude,
    longitude: peak.longitude,
  });
  const isBig = estimate.bytes > WARN_BYTES;

  async function start() {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setError("No map token configured.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await downloadPeak(
        {
          slug: peak.slug,
          name: peak.name,
          latitude: peak.latitude,
          longitude: peak.longitude,
          routePolys,
          photoUrls,
          payload: { peak, routes, photos, photoUrls },
        },
        token,
        (p) => setProgress({ done: p.done, total: p.total, stage: p.stage })
      );
      notifyLocalStore();
      void entry;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
      setProgress(null);
      setConfirmBig(false);
    }
  }

  async function remove() {
    setBusy(true);
    await removePeakDownload(peak.slug);
    notifyLocalStore();
    setBusy(false);
  }

  if (saved) {
    return (
      <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-800">
              ✓ Available offline
            </p>
            <p className="mt-0.5 text-xs text-ink-faint">
              {saved.routeCount} route{saved.routeCount === 1 ? "" : "s"} ·{" "}
              {saved.photoCount} photo{saved.photoCount === 1 ? "" : "s"} ·{" "}
              {saved.tileCount.toLocaleString()} map tiles · {formatBytes(saved.bytes)}
            </p>
          </div>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs text-ink-muted transition hover:bg-ground/40 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold text-ink">Take it offline</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Maps, routes and photos on your phone — no signal needed.
          </p>
        </div>
        <span className="shrink-0 font-mono text-sm text-ink-muted">{estimate.label}</span>
      </div>

      {busy && progress && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-ground">
            <div
              className="h-full rounded-full bg-pine-600 transition-all"
              style={{ width: `${Math.round((100 * progress.done) / Math.max(progress.total, 1))}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">
            {progress.stage === "photos" ? "Saving photos" : "Saving map"} ·{" "}
            {progress.done}/{progress.total}
          </p>
        </div>
      )}

      {isBig && !confirmBig && !busy && (
        <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
          This one is large ({estimate.label}). On mobile data that may cost you — tap
          again to confirm.
        </p>
      )}

      {error && <p className="mt-3 text-xs text-red-700">{error}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => (isBig && !confirmBig ? setConfirmBig(true) : start())}
        className="mt-3 w-full rounded-xl bg-pine-600 py-2.5 text-sm font-semibold text-white transition hover:bg-pine-500 disabled:opacity-60"
      >
        {busy
          ? "Downloading…"
          : isBig && !confirmBig
            ? `Download anyway (${estimate.label})`
            : `Download ${peak.name}`}
      </button>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  formatBytes,
  listPeakDownloads,
  removePeakDownload,
  totalPeakBytes,
  type DownloadedPeak,
} from "@/lib/offline";
import { useLocalStore, notifyLocalStore } from "@/hooks/useLocalStore";

const EMPTY: DownloadedPeak[] = [];

/** What the browser says it has given us, and how much is left. */
function useStorageEstimate() {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    navigator.storage
      ?.estimate?.()
      .then((e) => {
        if (!cancelled && e.usage != null && e.quota != null) {
          setEst({ usage: e.usage, quota: e.quota });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return est;
}

export default function DownloadsPage() {
  const items = useLocalStore(listPeakDownloads, EMPTY);
  const storage = useStorageEstimate();
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
  }, []);

  async function remove(slug: string) {
    await removePeakDownload(slug);
    notifyLocalStore();
  }

  async function requestPersist() {
    const ok = await navigator.storage?.persist?.().catch(() => false);
    setPersisted(!!ok);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-6 md:pt-24">
      <h1 className="font-display text-2xl font-bold text-ink">Downloaded mountains</h1>
      <p className="mb-5 mt-1 text-sm text-ink-muted">
        Each one carries its summit, every route to the top, the terrain, the map and the
        photographs — all usable with no signal.
        {items.length > 0 && ` Using ${formatBytes(totalPeakBytes())}.`}
      </p>

      {/* The browser can evict this cache under pressure. Say so, and offer
          the one thing that reduces the risk. */}
      {items.length > 0 && persisted === false && (
        <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            These downloads can be cleared by your browser
          </p>
          <p className="mt-0.5 text-sm text-amber-900/80">
            Storage isn&apos;t marked persistent, so the browser may evict it when space runs
            low — including while you&apos;re on a mountain.
          </p>
          <button
            type="button"
            onClick={requestPersist}
            className="mt-2 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Keep these permanently
          </button>
        </div>
      )}

      {storage && (
        <p className="mb-5 text-xs text-ink-faint">
          {formatBytes(storage.usage)} used of about {formatBytes(storage.quota)} this site
          may store
          {persisted ? " · marked persistent" : ""}
        </p>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-ink-faint">
          Nothing downloaded yet. Open a peak and tap{" "}
          <span className="font-semibold text-ink">Download</span> before you lose signal.
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {items.map((d) => (
            <li key={d.slug} className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-pine-600/15 text-xl">
                ⛰
              </div>
              <Link href={`/peaks/${d.slug}`} className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{d.name}</div>
                <div className="mt-0.5 text-xs text-ink-muted">
                  {d.routeCount} route{d.routeCount === 1 ? "" : "s"} · {d.photoCount} photo
                  {d.photoCount === 1 ? "" : "s"} · {d.tileCount.toLocaleString()} tiles ·{" "}
                  {formatBytes(d.bytes)}
                </div>
                <div className="mt-0.5 text-[11px] text-ink-faint">
                  saved {new Date(d.downloadedAt).toLocaleDateString()}
                </div>
              </Link>
              <button
                onClick={() => remove(d.slug)}
                className="flex-none rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:text-red-700"
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

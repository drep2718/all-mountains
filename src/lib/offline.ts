// Offline download manager: tells the service worker which map tiles to cache
// for a trail, and records what's been downloaded so it can be listed/removed.

import { estimateBytes, formatBytes, padBBox, tilesForBBox, tileUrl, type BBox } from "@/lib/tiles";

const INDEX_KEY = "am.offline.index";

/** Zoom span for a downloaded trail: overview through on-trail detail. */
export const MIN_Z = 10;
export const MAX_Z = 14;
/** Margin around the trail bbox, km — enough to cover an off-route detour. */
export const PAD_KM = 3;

export interface DownloadedTrail {
  routeId: number;
  name: string;
  bbox: BBox;
  tileCount: number;
  bytes: number;
  downloadedAt: number;
  /** The trail itself, so the detail view works with no network at all. */
  payload?: unknown;
}

export interface DownloadProgress {
  done: number;
  total: number;
  bytes: number;
}

function readIndex(): DownloadedTrail[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(INDEX_KEY) || "[]") as DownloadedTrail[];
  } catch {
    return [];
  }
}

function writeIndex(list: DownloadedTrail[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    /* quota — the tiles are still cached, only the index entry is lost */
  }
}

export function listDownloads(): DownloadedTrail[] {
  return readIndex().sort((a, b) => b.downloadedAt - a.downloadedAt);
}

export function isDownloaded(routeId: number): boolean {
  return readIndex().some((d) => d.routeId === routeId);
}

export function getDownload(routeId: number): DownloadedTrail | null {
  return readIndex().find((d) => d.routeId === routeId) ?? null;
}

/** Tiles needed for a trail — used for both the estimate and the download. */
export function planTiles(bbox: BBox) {
  const padded = padBBox(bbox, PAD_KM);
  const tiles = tilesForBBox(padded, MIN_Z, MAX_Z);
  return { padded, tiles, estimatedBytes: estimateBytes(tiles.length) };
}

export function estimateLabel(bbox: BBox): string {
  return formatBytes(planTiles(bbox).estimatedBytes);
}

export async function swReady(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

/**
 * Download a trail for offline use: its map tiles plus its own data.
 * Resolves when every tile has been attempted.
 */
export async function downloadTrail(
  route: { id: number; name: string | null },
  bbox: BBox,
  token: string,
  payload: unknown,
  onProgress?: (p: DownloadProgress) => void
): Promise<DownloadedTrail> {
  const reg = await swReady();
  const { padded, tiles } = planTiles(bbox);
  const urls = tiles.map((t) => tileUrl(t, token));
  const id = `dl_${route.id}_${Date.now()}`;

  let bytes = 0;

  if (reg?.active) {
    await new Promise<void>((resolve) => {
      const onMessage = (event: MessageEvent) => {
        const m = event.data;
        if (!m || m.id !== id) return;
        if (m.type === "CACHE_PROGRESS") {
          bytes = m.bytes || bytes;
          onProgress?.({ done: m.done, total: m.total, bytes });
        } else if (m.type === "CACHE_DONE") {
          bytes = m.bytes || bytes;
          onProgress?.({ done: m.done, total: m.total, bytes });
          navigator.serviceWorker.removeEventListener("message", onMessage);
          resolve();
        }
      };
      navigator.serviceWorker.addEventListener("message", onMessage);
      reg.active!.postMessage({ type: "CACHE_TILES", id, urls });

      // Never hang the UI forever if the SW dies mid-download.
      setTimeout(() => {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        resolve();
      }, 5 * 60 * 1000);
    });
  } else {
    // No service worker (e.g. dev over plain http) — still fill the Cache API
    // directly so the tiles are there.
    const cache = await caches.open("am-tiles-v1");
    let done = 0;
    for (const url of urls) {
      try {
        const res = await fetch(url, { mode: "cors" });
        if (res.ok) {
          bytes += Number(res.headers.get("content-length") || 0);
          await cache.put(url, res.clone());
        }
      } catch {
        /* skip */
      }
      done++;
      if (done % 5 === 0 || done === urls.length) {
        onProgress?.({ done, total: urls.length, bytes });
      }
    }
  }

  const entry: DownloadedTrail = {
    routeId: route.id,
    name: route.name || "Unnamed trail",
    bbox: padded,
    tileCount: urls.length,
    bytes: bytes || estimateBytes(urls.length),
    downloadedAt: Date.now(),
    payload,
  };
  writeIndex([entry, ...readIndex().filter((d) => d.routeId !== route.id)]);
  return entry;
}

/** Remove a trail's index entry and its cached tiles. */
export async function removeDownload(routeId: number): Promise<void> {
  const entry = getDownload(routeId);
  writeIndex(readIndex().filter((d) => d.routeId !== routeId));
  if (!entry || typeof caches === "undefined") return;

  // Only delete tiles no other download still needs.
  const remaining = readIndex();
  const stillNeeded = new Set<string>();
  for (const d of remaining) {
    for (const t of tilesForBBox(d.bbox, MIN_Z, MAX_Z)) {
      stillNeeded.add(`${t.z}/${t.x}/${t.y}`);
    }
  }

  try {
    const cache = await caches.open("am-tiles-v1");
    for (const t of tilesForBBox(entry.bbox, MIN_Z, MAX_Z)) {
      if (stillNeeded.has(`${t.z}/${t.x}/${t.y}`)) continue;
      for (const req of await cache.keys()) {
        if (req.url.includes(`/${t.z}/${t.x}/${t.y}`)) await cache.delete(req);
      }
    }
  } catch {
    /* best effort */
  }
}

export function totalDownloadedBytes(): number {
  return readIndex().reduce((sum, d) => sum + (d.bytes || 0), 0);
}

export { formatBytes };

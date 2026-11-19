// Offline download manager: tells the service worker which map tiles to cache
// for a trail, and records what's been downloaded so it can be listed/removed.

import { estimateBytes, formatBytes, padBBox, tilesForBBox, tileUrl, type BBox } from "@/lib/tiles";

const INDEX_KEY = "am.offline.index";

/**
 * Cache holding downloaded map tiles. Unversioned on purpose so a service
 * worker update never deletes a user's offline maps.
 * Must match TILES in public/sw.js.
 */
export const TILE_CACHE = "am-tiles";

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
    const cache = await caches.open(TILE_CACHE);
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

  // Cache the trail's own page too. Without this the map tiles are on the
  // device but opening the trail offline lands on the "you're offline" page —
  // which defeats the point of having downloaded it.
  await cacheTrailPage(route.id);

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

/**
 * Cache name for pages and app code. MUST match SHELL in public/sw.js —
 * the service worker deletes every cache not in its KEEP list on activate, so
 * a drift here means downloaded pages are silently thrown away on the next
 * update. `offline.sync.test.ts` fails the build if these diverge.
 */
export const SHELL_CACHE = "am-shell-v4";

/**
 * Cache the trail's page *and the JavaScript that renders it*.
 *
 * Caching the HTML alone is not enough: the document is a shell that React
 * hydrates, so without its chunks an offline visit renders the nav bar and an
 * endless spinner. The service worker only sees requests made after it takes
 * control, which misses the very first page load, so the assets this page
 * actually used are read from the Performance timeline and cached explicitly.
 */
async function cacheTrailPage(routeId: number): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(SHELL_CACHE);

    const res = await fetch(`/routes/${routeId}`, { headers: { Accept: "text/html" } });
    if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
      await cache.put(`/routes/${routeId}`, res.clone());
    }

    const assets = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => {
        try {
          const url = new URL(u);
          return (
            url.origin === location.origin &&
            url.pathname.startsWith("/_next/") &&
            !url.searchParams.has("_rsc")
          );
        } catch {
          return false;
        }
      });

    await Promise.all(
      [...new Set(assets)].map(async (u) => {
        try {
          if (await cache.match(u)) return;
          const r = await fetch(u);
          if (r.ok) await cache.put(u, r.clone());
        } catch {
          /* one missing asset must not fail the download */
        }
      })
    );
  } catch {
    /* best effort — tiles and trail data are already saved */
  }
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
    const cache = await caches.open(TILE_CACHE);
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

// ---------------------------------------------------------------------------
// Downloading a mountain
//
// The unit of offline is a summit, not a trail. "Download Mount Rainier" takes
// the peak, every route to its top, a tile corridor around those routes plus a
// disc over the summit, the photographs, and the page that renders it all.
// ---------------------------------------------------------------------------

import { planMountainTiles } from "@/lib/tiles";
import { decodeSegments } from "@/lib/polyline";

const PEAK_INDEX_KEY = "am.offline.peaks";
/** Photos are the user's data like tiles are: unversioned so updates keep them. */
export const IMAGE_CACHE = "am-images";

export interface DownloadedPeak {
  slug: string;
  name: string;
  tileCount: number;
  photoCount: number;
  routeCount: number;
  bytes: number;
  downloadedAt: number;
  /** Peak + routes + photo metadata, so the page works with no network at all. */
  payload?: unknown;
}

function readPeakIndex(): DownloadedPeak[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(PEAK_INDEX_KEY) || "[]") as DownloadedPeak[];
  } catch {
    return [];
  }
}

function writePeakIndex(list: DownloadedPeak[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PEAK_INDEX_KEY, JSON.stringify(list));
  } catch {
    /* quota — tiles and images are still cached, only the index entry is lost */
  }
}

export const listPeakDownloads = (): DownloadedPeak[] =>
  readPeakIndex().sort((a, b) => b.downloadedAt - a.downloadedAt);

export const isPeakDownloaded = (slug: string): boolean =>
  readPeakIndex().some((d) => d.slug === slug);

export const getPeakDownload = (slug: string): DownloadedPeak | null =>
  readPeakIndex().find((d) => d.slug === slug) ?? null;

export interface PeakDownloadInput {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Encoded polylines of the routes to this summit. */
  routePolys: string[];
  /** Full-size photo URLs to keep for offline viewing. */
  photoUrls: string[];
  /** Anything the page needs to render with no network. */
  payload?: unknown;
}

/** What a download will cost, before committing to it. */
export function estimatePeakDownload(input: Pick<PeakDownloadInput, "routePolys" | "latitude" | "longitude" | "photoUrls">) {
  const lines = input.routePolys.flatMap((p) => decodeSegments(p));
  const plan = planMountainTiles(lines, { lat: input.latitude, lng: input.longitude });
  // Commons thumbnails at 1600px run ~250 KB; close enough to warn on.
  const photoBytes = input.photoUrls.length * 250 * 1024;
  return {
    tileCount: plan.tiles.length,
    byZoom: plan.byZoom,
    bytes: plan.estimatedBytes + photoBytes,
    label: formatBytes(plan.estimatedBytes + photoBytes),
  };
}

/**
 * Download everything needed to use this mountain with no signal.
 * Resolves when every asset has been attempted; one missing photo never fails
 * the download.
 */
export async function downloadPeak(
  input: PeakDownloadInput,
  token: string,
  onProgress?: (p: DownloadProgress & { stage: string }) => void
): Promise<DownloadedPeak> {
  const lines = input.routePolys.flatMap((p) => decodeSegments(p));
  const plan = planMountainTiles(lines, { lat: input.latitude, lng: input.longitude });
  const urls = plan.tiles.map((t) => tileUrl(t, token));
  const reg = await swReady();
  const id = `dlp_${input.slug}_${Date.now()}`;

  let bytes = 0;

  // --- map tiles ---
  if (reg?.active) {
    await new Promise<void>((resolve) => {
      const onMessage = (event: MessageEvent) => {
        const m = event.data;
        if (!m || m.id !== id) return;
        if (m.type === "CACHE_PROGRESS" || m.type === "CACHE_DONE") {
          bytes = m.bytes || bytes;
          onProgress?.({ done: m.done, total: m.total, bytes, stage: "map" });
        }
        if (m.type === "CACHE_DONE") {
          navigator.serviceWorker.removeEventListener("message", onMessage);
          resolve();
        }
      };
      navigator.serviceWorker.addEventListener("message", onMessage);
      reg.active!.postMessage({ type: "CACHE_TILES", id, urls });
      setTimeout(() => {
        navigator.serviceWorker.removeEventListener("message", onMessage);
        resolve();
      }, 10 * 60 * 1000);
    });
  } else {
    const cache = await caches.open(TILE_CACHE);
    let done = 0;
    for (const url of urls) {
      try {
        const res = await fetch(url, { mode: "cors" });
        if (res.ok) {
          bytes += Number(res.headers.get("content-length") || 0);
          await cache.put(url, res.clone());
        }
      } catch {
        /* a missing tile is a blank square, not a failed download */
      }
      done++;
      if (done % 10 === 0 || done === urls.length) {
        onProgress?.({ done, total: urls.length, bytes, stage: "map" });
      }
    }
  }

  // --- photographs ---
  let photoCount = 0;
  if (typeof caches !== "undefined" && input.photoUrls.length) {
    const imgCache = await caches.open(IMAGE_CACHE);
    let done = 0;
    for (const url of input.photoUrls) {
      try {
        if (!(await imgCache.match(url))) {
          const res = await fetch(url, { mode: "cors" });
          if (res.ok) {
            bytes += Number(res.headers.get("content-length") || 0);
            await imgCache.put(url, res.clone());
          }
        }
        photoCount++;
      } catch {
        /* skip */
      }
      done++;
      onProgress?.({ done, total: input.photoUrls.length, bytes, stage: "photos" });
    }
  }

  // --- the page itself ---
  await cachePeakPage(input.slug);

  const entry: DownloadedPeak = {
    slug: input.slug,
    name: input.name,
    tileCount: urls.length,
    photoCount,
    routeCount: input.routePolys.length,
    bytes: bytes || estimateBytes(urls.length),
    downloadedAt: Date.now(),
    payload: input.payload,
  };
  writePeakIndex([entry, ...readPeakIndex().filter((d) => d.slug !== input.slug)]);
  return entry;
}

/**
 * Cache the peak's page and the JavaScript that renders it.
 *
 * Caching the HTML alone is not enough: the document is a shell React
 * hydrates, so without its chunks an offline visit shows the nav bar and a
 * spinner forever. The service worker only sees requests made after it takes
 * control, which misses the first load — so the assets this page actually used
 * are read from the Performance timeline and cached explicitly.
 */
async function cachePeakPage(slug: string): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(SHELL_CACHE);
    const res = await fetch(`/peaks/${slug}`, { headers: { Accept: "text/html" } });
    if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
      await cache.put(`/peaks/${slug}`, res.clone());
    }

    const assets = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .filter((u) => {
        try {
          const url = new URL(u);
          return (
            url.origin === location.origin &&
            url.pathname.startsWith("/_next/") &&
            !url.searchParams.has("_rsc")
          );
        } catch {
          return false;
        }
      });

    await Promise.all(
      [...new Set(assets)].map(async (u) => {
        try {
          if (await cache.match(u)) return;
          const r = await fetch(u);
          if (r.ok) await cache.put(u, r.clone());
        } catch {
          /* one missing asset must not fail the download */
        }
      })
    );
  } catch {
    /* best effort — tiles, photos and payload are already saved */
  }
}

/** Remove a mountain's download: its index entry, its tiles, its photos. */
export async function removePeakDownload(slug: string): Promise<void> {
  const entry = getPeakDownload(slug);
  writePeakIndex(readPeakIndex().filter((d) => d.slug !== slug));
  if (!entry || typeof caches === "undefined") return;

  // Photos are per-peak, so they can go. Tiles may be shared with a
  // neighbouring mountain, so they are left for a future sweep rather than
  // deleted from under another download.
  try {
    const payload = entry.payload as { photoUrls?: string[] } | undefined;
    if (payload?.photoUrls?.length) {
      const imgCache = await caches.open(IMAGE_CACHE);
      await Promise.all(payload.photoUrls.map((u) => imgCache.delete(u)));
    }
  } catch {
    /* best effort */
  }
}

export const totalPeakBytes = (): number =>
  readPeakIndex().reduce((sum, d) => sum + (d.bytes || 0), 0);

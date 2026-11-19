/**
 * Offline download manager.
 *
 * The unit of offline is a summit, not a trail: "download Mount Rainier"
 * takes the peak, every route to its top, the terrain under them, the map,
 * the photographs and the pages that render it all. The per-trail downloader
 * this replaced is gone — a trail belongs to a mountain now.
 */

import { formatBytes, tileUrl } from "@/lib/tiles";

export { formatBytes };

/**
 * Cache holding downloaded map tiles. Unversioned on purpose so a service
 * worker update never deletes a user's offline maps.
 * Must match TILES in public/sw.js.
 */
export const TILE_CACHE = "am-tiles";

/**
 * Cache name for pages and app code. MUST match SHELL in public/sw.js —
 * the service worker deletes every cache not in its KEEP list on activate, so
 * a drift here means downloaded pages are silently thrown away on the next
 * update. `offline.sync.test.ts` fails the build if these diverge.
 */
export const SHELL_CACHE = "am-shell-v4";

export interface DownloadProgress {
  done: number;
  total: number;
  bytes: number;
}

/** The active service worker, or null when there isn't one (e.g. dev). */
export async function swReady(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    // ready never resolves in development, where registration is disabled.
    // A first production visit may still be installing; bound that wait too.
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return null;
    if (registration.active) return registration;
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 10000); }),
      ]);
    } finally { clearTimeout(timer!); }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Downloading a mountain
//
// The unit of offline is a summit, not a trail. "Download Mount Rainier" takes
// the peak, every route to its top, a tile corridor around those routes plus a
// disc over the summit, the photographs, and the page that renders it all.
// ---------------------------------------------------------------------------

import { demTileUrl, planMountainTiles } from "@/lib/tiles";
import { GLYPH_RANGES, LABEL_FONT, TILE_BYTES, glyphUrl } from "@/lib/mapStyle";
import { decodeSegments } from "@/lib/polyline";

const PEAK_INDEX_KEY = "am.offline.peaks";

/**
 * Both styles the app renders, because a download that caches one of them
 * leaves the other blank on the mountain. Navigation uses the topo style; the
 * 3-D peak view uses satellite. Caching only the default meant the 3-D view
 * came up as route lines floating on black once the signal went.
 */
const OFFLINE_STYLES = ["outdoors-v12", "satellite-streets-v12"] as const;
/** Measured, not guessed — see TILE_BYTES in mapStyle.ts. */
const BYTES_PER_IMAGERY_TILE = TILE_BYTES.satellite + TILE_BYTES.outdoors;
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
    throw new Error("Couldn't save the download index. Free some device storage and retry.");
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
  // The seven Whitney photos measured 6.0 MB in total, not 250 KB each.
  // Photo sizes vary; this is a conservative estimate, actual bytes are recorded.
  const photoBytes = input.photoUrls.length * 900 * 1024;
  // The DEM collapses to zoom 14, so it is far fewer tiles than the imagery.
  const demCount = new Set(
    plan.tiles.map((t) => `${Math.min(t.z, 14)}/${t.x >> Math.max(0, t.z - 14)}/${t.y >> Math.max(0, t.z - 14)}`)
  ).size;
  // Use measured sizes for both imagery styles and the lossless DEM.
  // A flat 25 KB per tile badly underestimates a real mountain download.
  const bytes =
    plan.tiles.length * BYTES_PER_IMAGERY_TILE + photoBytes + demCount * TILE_BYTES.dem + GLYPH_RANGES.length * 73 * 1024;
  return {
    tileCount: plan.tiles.length * OFFLINE_STYLES.length + demCount + GLYPH_RANGES.length,
    byZoom: plan.byZoom,
    bytes,
    label: `~${formatBytes(bytes)}`,
  };
}

/**
 * Download everything needed to use this mountain with no signal.
 * Resolves after required map assets and pages are cached. Optional missing
 * photographs are skipped; incomplete maps must never be labelled available.
 */
export async function downloadPeak(
  input: PeakDownloadInput,
  token: string,
  onProgress?: (p: DownloadProgress & { stage: string }) => void
): Promise<DownloadedPeak> {
  const lines = input.routePolys.flatMap((p) => decodeSegments(p));
  const plan = planMountainTiles(lines, { lat: input.latitude, lng: input.longitude });
  // Imagery plus the terrain DEM underneath it. Deduplicated because several
  // zoom levels collapse onto the same DEM tile.
  const demUrls = [...new Set(plan.tiles.map((t) => demTileUrl(t, token)))];
  const urls = [
    ...plan.tiles.flatMap((t) => OFFLINE_STYLES.map((style) => tileUrl(t, token, style))),
    ...demUrls,
    // Without the font, every labelled layer throws on load and takes the
    // rest of the map setup with it.
    ...GLYPH_RANGES.map((r) => glyphUrl(LABEL_FONT, r, token)),
  ];
  const reg = await swReady();
  const id = `dlp_${input.slug}_${Date.now()}`;

  let bytes = 0;

  // --- map tiles ---
  if (reg?.active) {
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const cleanup = () => {
        clearTimeout(timeout);
        channel.port1.close();
        navigator.serviceWorker.removeEventListener("message", onMessage);
      };
      const onMessage = (event: MessageEvent) => {
        const m = event.data;
        if (!m || m.id !== id) return;
        if (m.type === "CACHE_PROGRESS" || m.type === "CACHE_DONE" || m.type === "CACHE_ERROR") {
          bytes = m.bytes ?? bytes;
          onProgress?.({ done: m.done, total: m.total, bytes, stage: "map" });
        }
        if (m.type === "CACHE_DONE" || m.type === "CACHE_ERROR") {
          cleanup();
          if (m.type === "CACHE_ERROR" || m.failed > 0) reject(new Error("Some map tiles couldn't be saved. Check your connection and retry."));
          else resolve();
        }
      };
      channel.port1.onmessage = onMessage;
      // Listen to old workers too, during a deployment transition.
      navigator.serviceWorker.addEventListener("message", onMessage);
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("The map download timed out. Check your connection and retry."));
      }, 4 * 60 * 1000);
      try { reg.active!.postMessage({ type: "CACHE_TILES", id, urls }, [channel.port2]); }
      catch (e) { cleanup(); reject(e); }
    });
  } else {
    const cache = await caches.open(TILE_CACHE);
    let done = 0;
    let failed = 0;
    for (const url of urls) {
      try {
        const res = (await cache.match(url)) ?? (await fetch(url, { mode: "cors" }));
        if (!res.ok) throw new Error("Map tile unavailable");
        bytes += (await res.clone().arrayBuffer()).byteLength;
        await cache.put(url, res);
      } catch { failed++; }
      done++;
      if (done % 10 === 0 || done === urls.length) {
        onProgress?.({ done, total: urls.length, bytes, stage: "map" });
      }
    }
    if (failed) throw new Error("Some map tiles couldn't be saved. Check your connection and retry.");
  }

  // --- photographs ---
  let photoCount = 0;
  if (typeof caches !== "undefined" && input.photoUrls.length) {
    const imgCache = await caches.open(IMAGE_CACHE);
    let done = 0;
    for (const url of input.photoUrls) {
      try {
        const existing = await imgCache.match(url);
        const res = existing ?? await fetch(url, { mode: "cors" });
        if (res.ok) {
          bytes += (await res.clone().arrayBuffer()).byteLength;
          if (!existing) await imgCache.put(url, res);
          photoCount++;
        }
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
    bytes,
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

    /**
     * The peak page and the navigation screen.
     *
     * /record is the whole point of downloading a mountain — you take it with
     * you so you can follow the route with no signal. Caching only the peak
     * page meant tapping Navigate on the trail landed on "You're offline",
     * which is the one moment the app must not fail. The worker matches
     * navigations with ignoreSearch, so one copy of /record serves every
     * ?peak=…&route=… combination.
     */
    const htmlAssets = new Set<string>();
    for (const path of [`/peaks/${slug}`, "/record", "/downloads", "/activities"]) {
      const res = await fetch(path, { cache: "reload", headers: { Accept: "text/html" } });
      if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
        const body = await res.clone().text();
        await cache.put(path, res.clone());
        // Scripts and stylesheets the document itself references. The
        // Performance timeline below only sees what *this* page loaded, so
        // without this /record would be cached as a shell with no code.
        for (const m of body.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)) {
          htmlAssets.add(m[1]);
        }
      } else { throw new Error("Offline page unavailable"); }
    }

    /**
     * Pull in the navigation map's chunk.
     *
     * NavMap is a dynamic import, so its chunk is only fetched when /record
     * actually mounts — which never happens while you are standing on the
     * peak page pressing Download. Importing it here makes the bundler fetch
     * it, and the worker caches it on the way past. Without this the
     * navigation screen opens offline to a permanent loading shimmer.
     */
    await import("@/components/NavMap");

    const assets = performance
      .getEntriesByType("resource")
      // A prior failed chunk request is not app code that needs saving.
      .filter((e) => !((e as PerformanceResourceTiming).responseStatus >= 400))
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
      [...new Set([...assets, ...htmlAssets])].map(async (u) => {
        try {
          if (await cache.match(u)) return;
          const r = await fetch(u);
          if (!r.ok) throw new Error("Offline code unavailable");
          await cache.put(u, r.clone());
        } catch { throw new Error("Couldn't save offline app code"); }
      })
    );
  } catch {
    throw new Error("Couldn't save the offline pages. Check your connection and retry.");
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

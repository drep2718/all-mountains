/* All Mountains service worker — offline safety.
 *
 * Three cache tiers:
 *   shell  — app pages/assets so the app opens with no signal
 *   tiles  — map imagery, explicitly downloaded per trail (never auto-evicted)
 *   data   — trail/peak JSON captured as you browse
 */

const VERSION = "v2";
const SHELL = `am-shell-${VERSION}`;
const TILES = `am-tiles-${VERSION}`;
const DATA = `am-data-${VERSION}`;
const KEEP = [SHELL, TILES, DATA];

// Kept small on purpose: precaching a hashed Next.js build from a static list
// goes stale instantly. The shell fills in at runtime instead.
const SHELL_URLS = ["/", "/offline", "/routes", "/peaks", "/downloads"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // Individually so one 404 can't fail the whole install.
      .then((c) => Promise.allSettled(SHELL_URLS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isTile = (url) =>
  url.hostname === "api.mapbox.com" &&
  (url.pathname.includes("/tiles/") || url.pathname.includes("/v4/"));

const isMapboxAsset = (url) =>
  url.hostname.endsWith("mapbox.com") || url.hostname.endsWith("mapbox.cn");

const isSupabase = (url) => url.pathname.startsWith("/rest/v1/");

/** Cache-first: offline maps must not depend on the network at all. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true, ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const fallback = await cache.match(request, { ignoreVary: true, ignoreSearch: true });
    if (fallback) return fallback;
    throw err;
  }
}

/**
 * Stale-while-revalidate: serve the cached copy immediately, but always refresh
 * it in the background.
 *
 * App code must NEVER be cache-first. Doing that pins users to whatever build
 * they first loaded — they would stop receiving updates, including fixes to the
 * GPS and offline code this app relies on for safety.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true });

  const update = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  // Cached copy now if we have one; otherwise wait for the network.
  if (hit) {
    update.catch(() => {});
    return hit;
  }
  const fresh = await update;
  if (fresh) return fresh;
  throw new Error("offline and not cached");
}

/** Network-first with cache fallback: fresh when online, still works offline. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreVary: true, ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Map imagery — always cache-first so a downloaded trail works with no signal.
  if (isTile(url) || isMapboxAsset(url)) {
    event.respondWith(cacheFirst(request, TILES));
    return;
  }

  // Trail/peak data from Supabase.
  if (isSupabase(url)) {
    event.respondWith(networkFirst(request, DATA));
    return;
  }

  // Same-origin: navigations fall back to the offline page.
  if (url.origin === self.location.origin) {
    if (request.mode === "navigate") {
      event.respondWith(
        networkFirst(request, SHELL).catch(async () => {
          const cache = await caches.open(SHELL);
          return (await cache.match(request, { ignoreSearch: true })) ||
            (await cache.match("/offline")) ||
            new Response("<h1>Offline</h1><p>This page isn't downloaded.</p>", {
              status: 200,
              headers: { "Content-Type": "text/html" },
            });
        })
      );
      return;
    }
    // App code and assets: never cache-first, or updates never reach the user.
    event.respondWith(
      staleWhileRevalidate(request, SHELL).catch(() => fetch(request))
    );
  }
});

// The page asks the SW to prefetch a trail's tiles, and gets progress back.
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "CACHE_TILES") return;

  event.waitUntil(
    (async () => {
      const cache = await caches.open(TILES);
      const urls = msg.urls || [];
      let done = 0;
      let bytes = 0;
      const CONCURRENCY = 6; // polite to the tile server
      let cursor = 0;

      const post = (payload) =>
        self.clients.matchAll().then((cs) => cs.forEach((c) => c.postMessage(payload)));

      async function worker() {
        while (cursor < urls.length) {
          const url = urls[cursor++];
          try {
            const existing = await cache.match(url);
            if (existing) {
              bytes += Number(existing.headers.get("content-length") || 0);
            } else {
              const res = await fetch(url, { mode: "cors" });
              if (res && res.ok) {
                bytes += Number(res.headers.get("content-length") || 0);
                await cache.put(url, res.clone());
              }
            }
          } catch {
            /* a missing tile must not abort the download */
          }
          done++;
          if (done % 5 === 0 || done === urls.length) {
            post({ type: "CACHE_PROGRESS", id: msg.id, done, total: urls.length, bytes });
          }
        }
      }

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      post({ type: "CACHE_DONE", id: msg.id, done, total: urls.length, bytes });
    })()
  );
});

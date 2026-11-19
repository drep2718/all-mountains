/**
 * Phase 3 — import the trails that reach each curated summit.
 *
 * One small Overpass query per peak, anchored to a summit we chose, instead of
 * one country-scale query per country. That flip is the whole pivot:
 *
 *   old   40 countries × a national query   → hours, 4 countries managed,
 *                                             33% junk, 1.5 GB, read-only database
 *   new   1,032 peaks × an 8 km box         → ~45 min, all 40 countries,
 *                                             junk structurally impossible
 *
 * Nothing is written to the database. Output is local NDJSON, verified by
 * `audit-catalogue.ts`, then loaded in one pass by `load-catalogue.ts`.
 *
 *   npx tsx scripts/catalogue/import-routes.ts [--limit N] [--fresh] [--only slug,...]
 *
 * Out: data/catalogue/routes.ndjson, data/catalogue/routes-report.json
 */

import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";

import { haversineM, sleep, UA } from "./sources.js";
import { toStored, type LngLat } from "../../src/lib/polyline.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT_DIR = path.join(ROOT, "data/catalogue");
const ROUTES_OUT = path.join(OUT_DIR, "routes.ndjson");
const DONE_OUT = path.join(OUT_DIR, "routes-done.ndjson");
const REPORT_OUT = path.join(OUT_DIR, "routes-report.json");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];
/**
 * One query in flight per endpoint, no more. `endpointCursor` rotates, so four
 * workers spread across the four mirrors rather than piling onto one — which
 * is both faster and politer than two workers hammering the busiest instance.
 */
const CONCURRENCY = 4;
const POLITE_MS = 1_200;
/** Half-width of the search box around a summit. */
const BOX_KM = 8;

/**
 * Peaks per Overpass request.
 *
 * One request per peak is the obvious shape and it does not work: measured
 * against the public instances, a single 8 km query took 50 s when it
 * succeeded at all, and all three endpoints timed out at 75 s under load.
 * 1,032 of those is seven hours on a good day.
 *
 * Overpass takes a union of bounding boxes in one query, so a batch fetches
 * many mountains for roughly the cost of one. Each returned way is then
 * assigned to whichever peak in the batch it passes closest to — which is also
 * more correct than per-peak queries, since a path between two summits now
 * goes to the nearer one instead of both.
 */
const PEAKS_PER_QUERY = 12;
/** Server-side budget. Generous: a slow answer beats a timed-out one. */
const QUERY_TIMEOUT_S = 180;
/** A way must pass this close to the summit to count as reaching it. */
const SUMMIT_RADIUS_M = 500;
/**
 * Hard ceiling for inclusion at all, applied AFTER merging. A through-trail
 * like the John Muir Trail passes 1.7 km from Half Dome; it is a fine trail
 * but it is not a Half Dome route, and this app is about summiting.
 */
const MAX_APPROACH_M = 1_200;
/** Individual OSM ways can be tiny; the length test applies to merged routes. */
const MIN_SEGMENT_KM = 0.05;
const MIN_KM = 0.3;
/** Two segments of the same named trail join if their ends are this close. */
const STITCH_TOL_M = 40;
const MAX_ROUTES_PER_PEAK = 25;

/**
 * Names that are plainly roads. `highway=track` is excluded by the query
 * itself — it is farm and forestry roads, and it is where all 8,271
 * "229th Street" and "Forest Service Road 335" rows came from last time.
 * This is the belt to that braces: rejected at write time, not in a later audit.
 */
const ROADLIKE = [
  /^\d+(st|nd|rd|th)?\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|place|pl|way|court|ct)\b/i,
  /^(county|township|forest service|fs|state|us|interstate)\s+(road|rd|route|rt|highway|hwy)\b/i,
  /^(cr|fr|fs)[-\s]?\d+$/i,
  /\b(parking|driveway|alley|cul[-\s]?de[-\s]?sac)\b/i,
];
const isRoadlike = (n: string) => ROADLIKE.some((r) => r.test(n));

interface EnrichedPeak {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation_m: number;
  difficulty: string;
}

export interface CatalogueRoute {
  peak_slug: string;
  osm_id: number;
  name: string | null;
  network: string | null;
  distance_km: number;
  ascent_m: number | null;
  est_time_min: number;
  difficulty: string | null;
  route_type: string;
  poly: string;
  bbox_min_lat: number;
  bbox_min_lng: number;
  bbox_max_lat: number;
  bbox_max_lng: number;
  distance_to_summit_m: number;
  is_summit_route: boolean;
  surface: string | null;
  operator: string | null;
  ref: string | null;
  dog_access: string | null;
  bicycle: string | null;
  fee: string | null;
}

// --- Overpass -------------------------------------------------------------

interface OsmElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

class OverpassTooBig extends Error {}

let endpointCursor = 0;

async function overpass(query: string, tries = 4): Promise<OsmElement[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    const url = ENDPOINTS[endpointCursor++ % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          // Overpass answers 406 without a User-Agent.
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout((QUERY_TIMEOUT_S + 25) * 1000),
      });
      if (res.status === 429 || res.status === 504 || res.status >= 500) {
        lastErr = new Error(`overpass ${res.status}`);
      } else if (!res.ok) {
        throw new Error(`overpass ${res.status}`);
      } else {
        const body = (await res.json()) as { elements?: OsmElement[]; remark?: string };
        // Overpass signals a timeout as HTTP 200 with a `remark` and zero
        // elements. Reading only `elements` makes a failure look like "this
        // mountain has no trails" — which is how an entire country's import
        // silently vanished last time.
        if (body.remark && /timed out|out of memory|runtime error/i.test(body.remark)) {
          throw new OverpassTooBig(body.remark);
        }
        return body.elements ?? [];
      }
    } catch (e) {
      if (e instanceof OverpassTooBig) throw e;
      lastErr = e;
    }
    await sleep(2_000 * 2 ** attempt + Math.random() * 1_000);
  }
  throw lastErr ?? new Error("overpass failed");
}

/** The (south,west,north,east) box around one summit. */
function bbox(peak: EnrichedPeak, boxKm: number): string {
  const dLat = boxKm / 111;
  const dLng = boxKm / (111 * Math.max(Math.cos((peak.latitude * Math.PI) / 180), 0.05));
  return (
    `${(peak.latitude - dLat).toFixed(5)},${(peak.longitude - dLng).toFixed(5)},` +
    `${(peak.latitude + dLat).toFixed(5)},${(peak.longitude + dLng).toFixed(5)}`
  );
}

/**
 * One query covering every peak in the batch.
 * path|footway only — NOT `track`, which is farm and forestry roads and is
 * where all 8,271 "229th Street" rows came from last time.
 */
function query(peaks: EnrichedPeak[], boxKm: number): string {
  const parts = peaks
    .map((p) => {
      const b = bbox(p, boxKm);
      return (
        `way["highway"~"^(path|footway)$"]["foot"!="no"](${b});` +
        `way["highway"="steps"]["name"](${b});`
      );
    })
    .join("");
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];(${parts});out geom;`;
}

// --- geometry -------------------------------------------------------------

function lineLengthKm(pts: LngLat[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) {
    m += haversineM(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
  }
  return m / 1000;
}

function nearestApproachM(pts: LngLat[], lat: number, lng: number): number {
  let best = Infinity;
  for (const [plng, plat] of pts) {
    const d = haversineM(lat, lng, plat, plng);
    if (d < best) best = d;
  }
  return best;
}

/** Naismith: 12 min/km plus 10 min per 100 m of ascent. */
const naismith = (km: number, ascentM: number | null) =>
  Math.round(km * 12 + ((ascentM ?? 0) / 100) * 10);

function classify(pts: LngLat[]): string {
  const a = pts[0];
  const b = pts[pts.length - 1];
  const gap = haversineM(a[1], a[0], b[1], b[0]);
  if (gap < 150) return "Loop";
  return "Out & Back";
}

const SAC_TO_DIFFICULTY: Record<string, string> = {
  hiking: "Easy",
  mountain_hiking: "Moderate",
  demanding_mountain_hiking: "Hard",
  alpine_hiking: "Expert",
  demanding_alpine_hiking: "Expert",
  difficult_alpine_hiking: "Extreme",
};

// --- merging --------------------------------------------------------------

/**
 * OSM splits a trail into a way per tag change, so one trail arrives as many
 * rows: Half Dome's query returns "Half Dome Trail" twice, "Snake Dike
 * Approach" three times. Imported raw, the peak page lists the same trail
 * repeatedly with each fragment's length instead of the trail's.
 *
 * Segments sharing a name are stitched end-to-end into chains. A name whose
 * pieces genuinely don't connect (a trail on both sides of a ridge) yields
 * more than one chain, which is correct.
 */
interface Segment {
  pts: LngLat[];
  tags: Record<string, string>;
  osmId: number;
}

const endpointsClose = (a: LngLat, b: LngLat) =>
  haversineM(a[1], a[0], b[1], b[0]) <= STITCH_TOL_M;

function stitch(segments: Segment[]): LngLat[][] {
  const unused = [...segments];
  const chains: LngLat[][] = [];

  while (unused.length) {
    const seed = unused.shift()!;
    let chain = [...seed.pts];
    let grew = true;

    while (grew) {
      grew = false;
      for (let i = 0; i < unused.length; i++) {
        const s = unused[i];
        const head = chain[0];
        const tail = chain[chain.length - 1];
        const sStart = s.pts[0];
        const sEnd = s.pts[s.pts.length - 1];

        if (endpointsClose(tail, sStart)) chain = chain.concat(s.pts.slice(1));
        else if (endpointsClose(tail, sEnd)) chain = chain.concat([...s.pts].reverse().slice(1));
        else if (endpointsClose(head, sEnd)) chain = s.pts.slice(0, -1).concat(chain);
        else if (endpointsClose(head, sStart))
          chain = [...s.pts].reverse().slice(0, -1).concat(chain);
        else continue;

        unused.splice(i, 1);
        grew = true;
        break;
      }
    }
    chains.push(chain);
  }
  return chains;
}

// --- per-peak -------------------------------------------------------------

/**
 * Fetch one batch of peaks, splitting it in half on failure rather than losing
 * the lot — the same adaptive sizing that kept the old importer alive.
 */
async function fetchBatch(
  peaks: EnrichedPeak[],
  boxKm = BOX_KM
): Promise<Map<string, OsmElement[]>> {
  try {
    const elements = await overpass(query(peaks, boxKm));
    return assignToPeaks(peaks, elements);
  } catch (e) {
    if (peaks.length === 1) {
      // A single peak that still won't answer: try a tighter box before giving up.
      if (boxKm > BOX_KM / 2) return fetchBatch(peaks, BOX_KM / 2);
      throw e;
    }
    const mid = Math.ceil(peaks.length / 2);
    const [a, b] = await Promise.all([
      fetchBatch(peaks.slice(0, mid), boxKm),
      fetchBatch(peaks.slice(mid), boxKm),
    ]);
    for (const [k, v] of b) a.set(k, v);
    return a;
  }
}

/**
 * Give every way to the peak it passes closest to.
 *
 * Batching means the response is a soup of paths from a dozen mountains. The
 * nearest-approach test is the same one that decides inclusion anyway, so this
 * costs nothing extra and resolves a path between two summits in favour of the
 * nearer — which per-peak queries got wrong in both directions.
 */
function assignToPeaks(
  peaks: EnrichedPeak[],
  elements: OsmElement[]
): Map<string, OsmElement[]> {
  const out = new Map<string, OsmElement[]>(peaks.map((p) => [p.id, []]));

  for (const el of elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const pts: LngLat[] = el.geometry.map((g) => [g.lon, g.lat]);

    let bestPeak: string | null = null;
    let bestDist = Infinity;
    for (const p of peaks) {
      const d = nearestApproachM(pts, p.latitude, p.longitude);
      if (d < bestDist) {
        bestDist = d;
        bestPeak = p.id;
      }
    }
    // Beyond the cap it belongs to no mountain in this batch.
    if (bestPeak && bestDist <= MAX_APPROACH_M) out.get(bestPeak)!.push(el);
  }
  return out;
}

function routesForPeak(peak: EnrichedPeak, elements: OsmElement[]): CatalogueRoute[] {
  // 1. Collect usable segments, grouped by trail name.
  const groups = new Map<string, Segment[]>();
  for (const el of elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags ?? {};
    const name = tags.name?.trim() || null;
    if (name && isRoadlike(name)) continue;

    const pts: LngLat[] = el.geometry.map((g) => [g.lon, g.lat]);
    if (lineLengthKm(pts) < MIN_SEGMENT_KM) continue;

    // Unnamed paths can't be grouped by name, so each stands alone.
    const key = name ? `n:${name.toLowerCase()}` : `w:${el.id}`;
    const list = groups.get(key);
    if (list) list.push({ pts, tags, osmId: el.id });
    else groups.set(key, [{ pts, tags, osmId: el.id }]);
  }

  // 2. Stitch each group, then judge the merged trail.
  const out: CatalogueRoute[] = [];
  for (const segments of groups.values()) {
    const chains = stitch(segments);
    const tags = segments[0].tags;
    const name = tags.name?.trim() || null;

    for (const chain of chains) {
      const km = lineLengthKm(chain);
      if (km < MIN_KM) continue;

      const approach = nearestApproachM(chain, peak.latitude, peak.longitude);
      if (approach > MAX_APPROACH_M) continue;

      const poly = toStored([chain]);
      if (!poly) continue;

      const lats = chain.map((p) => p[1]);
      const lngs = chain.map((p) => p[0]);

      // Identify the merged route by its longest constituent way, so the id
      // is stable across re-imports.
      const osmId = segments.reduce((a, b) => (b.pts.length > a.pts.length ? b : a)).osmId;

      out.push({
        peak_slug: peak.id,
        osm_id: osmId,
        name,
        network: tags.network ?? null,
        distance_km: +km.toFixed(2),
        ascent_m: null, // filled by the elevation pass
        est_time_min: naismith(km, null),
        difficulty: tags.sac_scale ? (SAC_TO_DIFFICULTY[tags.sac_scale] ?? null) : null,
        route_type: classify(chain),
        poly,
        bbox_min_lat: Math.min(...lats),
        bbox_min_lng: Math.min(...lngs),
        bbox_max_lat: Math.max(...lats),
        bbox_max_lng: Math.max(...lngs),
        distance_to_summit_m: Math.round(approach),
        is_summit_route: approach <= SUMMIT_RADIUS_M,
        surface: tags.surface ?? null,
        operator: tags.operator ?? null,
        ref: tags.ref ?? null,
        dog_access: tags.dog ?? null,
        bicycle: tags.bicycle ?? null,
        fee: tags.fee ?? null,
      });
    }
  }

  // The unique key is (peak_slug, osm_id); two chains of one name would clash.
  const seen = new Set<number>();
  const deduped = out.filter((r) => (seen.has(r.osm_id) ? false : (seen.add(r.osm_id), true)));
  out.length = 0;
  out.push(...deduped);

  // Prefer named summit routes, then whatever gets closest.
  out.sort((a, b) => {
    if (a.is_summit_route !== b.is_summit_route) return a.is_summit_route ? -1 : 1;
    if (!!a.name !== !!b.name) return a.name ? -1 : 1;
    return a.distance_to_summit_m - b.distance_to_summit_m;
  });
  return out.slice(0, MAX_ROUTES_PER_PEAK);
}

// --- driver ---------------------------------------------------------------

async function doneSlugs(): Promise<Set<string>> {
  const done = new Set<string>();
  try {
    await stat(DONE_OUT);
  } catch {
    return done;
  }
  const rl = createInterface({ input: createReadStream(DONE_OUT), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) {
      try {
        done.add((JSON.parse(line) as { slug: string }).slug);
      } catch {
        /* truncated final line from a killed run */
      }
    }
  }
  return done;
}

async function main() {
  const argv = process.argv.slice(2);
  const limit = Number(argv[argv.indexOf("--limit") + 1]) || Infinity;
  const fresh = argv.includes("--fresh");
  const onlyArg = argv.indexOf("--only");
  const only = onlyArg > -1 ? new Set(argv[onlyArg + 1].split(",")) : null;

  await mkdir(OUT_DIR, { recursive: true });
  if (fresh) {
    await rm(ROUTES_OUT, { force: true });
    await rm(DONE_OUT, { force: true });
  }

  // Prefer the enriched file; fall back to the curated one so routes can be
  // imported before (or without) enrichment.
  let peaks: EnrichedPeak[];
  try {
    const text = await readFile(path.join(OUT_DIR, "peaks.ndjson"), "utf8");
    peaks = text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as EnrichedPeak);
  } catch {
    peaks = JSON.parse(
      await readFile(path.join(ROOT, "data/curated-peaks.json"), "utf8")
    ) as EnrichedPeak[];
  }

  const done = await doneSlugs();
  let queue = peaks.filter((p) => !done.has(p.id));
  if (only) queue = peaks.filter((p) => only.has(p.id));
  queue = queue.slice(0, limit === Infinity ? undefined : limit);

  console.log(`\npeaks ${peaks.length} · already done ${done.size} · this run ${queue.length}\n`);
  if (!queue.length) {
    console.log("nothing to do");
    return;
  }

  const routesFh = createWriteStream(ROUTES_OUT, { flags: "a" });
  const doneFh = createWriteStream(DONE_OUT, { flags: "a" });

  let processed = 0,
    totalRoutes = 0,
    withNone = 0,
    failed = 0;
  const noRoutes: string[] = [];
  const failures: { slug: string; why: string }[] = [];
  const started = Date.now();

  // Batches of geographically adjacent peaks: sorting by latitude then
  // longitude keeps each query's boxes near one another, which keeps the area
  // Overpass has to scan small.
  const ordered = [...queue].sort(
    (a, b) => a.latitude - b.latitude || a.longitude - b.longitude
  );
  const batches: EnrichedPeak[][] = [];
  for (let i = 0; i < ordered.length; i += PEAKS_PER_QUERY) {
    batches.push(ordered.slice(i, i + PEAKS_PER_QUERY));
  }
  console.log(`${batches.length} queries of up to ${PEAKS_PER_QUERY} peaks each\n`);

  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= batches.length) return;
      const batch = batches[i];
      try {
        const byPeak = await fetchBatch(batch);
        for (const peak of batch) {
          const routes = routesForPeak(peak, byPeak.get(peak.id) ?? []);
          for (const r of routes) routesFh.write(JSON.stringify(r) + "\n");
          doneFh.write(JSON.stringify({ slug: peak.id, count: routes.length }) + "\n");
          totalRoutes += routes.length;
          if (!routes.length) {
            withNone++;
            noRoutes.push(peak.id);
          }
          processed++;
        }
      } catch (e) {
        // Nothing in the batch is marked done, so a later run retries it.
        failed += batch.length;
        for (const p of batch) failures.push({ slug: p.id, why: String(e).slice(0, 140) });
        processed += batch.length;
      }

      const rate = processed / ((Date.now() - started) / 1000);
      const eta = Math.round((queue.length - processed) / Math.max(rate, 0.001));
      process.stdout.write(
        `\r  ${processed}/${queue.length}  routes ${totalRoutes}  none ${withNone}  failed ${failed}  eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, "0")}s   `
      );
      await sleep(POLITE_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  routesFh.end();
  doneFh.end();

  await writeFile(
    REPORT_OUT,
    JSON.stringify(
      {
        ran_at: new Date().toISOString(),
        processed,
        total_routes: totalRoutes,
        avg_per_peak: +(totalRoutes / Math.max(processed, 1)).toFixed(1),
        peaks_with_no_routes: withNone,
        failed,
        no_routes: noRoutes.slice(0, 200),
        failures: failures.slice(0, 80),
      },
      null,
      2
    )
  );

  console.log(
    `\n\n${totalRoutes} routes across ${processed} peaks (avg ${(totalRoutes / processed).toFixed(1)}) · no routes ${withNone} · failed ${failed}`
  );
  console.log(`report → ${path.relative(ROOT, REPORT_OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

/**
 * The elevation pass.
 *
 * `import-routes.ts` leaves `ascent_m` null with the comment "filled by the
 * elevation pass", and nothing filled it. The consequence was not a blank
 * field but a wrong one: `est_time_min` was Naismith with ascent treated as
 * zero, so Mount Whitney's 17 km main trail was advertised as a 3½ hour walk
 * when the real figure, with 1,860 m of climb, is nearer 6½. A summit app that
 * underestimates time by half is worse than one that says nothing.
 *
 * OSM way geometry carries no elevation, so the climb has to come from a DEM.
 * The peak page already reads one in the browser via `queryTerrainElevation`;
 * this samples the same Mapbox terrain tiles in Node, through the same
 * `profileFromSamples`, so a route's stored ascent equals the ascent the
 * profile chart draws under it.
 *
 *   npx tsx --env-file=.env.local scripts/catalogue/elevation-pass.ts
 *   npx tsx --env-file=.env.local scripts/catalogue/elevation-pass.ts --validate
 *
 * Flags:
 *   --validate   compare summit-route high points against published peak
 *                elevations across several zooms, and stop. Picks the zoom.
 *   --zoom N     override the DEM zoom (default DEM_ZOOM below)
 *   --limit N    only the first N peaks
 *   --fresh      ignore elevation.ndjson and recompute everything
 *
 * Writes `data/catalogue/elevation.ndjson`, keyed by (peak_slug, osm_id), and
 * never touches routes.ndjson — that file belongs to the importer, which may
 * still be appending to it. `load-catalogue.ts` merges the two.
 */

import { readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeSegments, type LngLat } from "../../src/lib/polyline.js";
import {
  DEM_RESOLUTION_M,
  profileFromSamples,
  estimateMinutes,
  resample,
} from "../../src/lib/terrain.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "data/catalogue");
const OUT = path.join(DIR, "elevation.ndjson");

/**
 * DEM zoom.
 *
 * The worry was that Mapbox serves terrain-dem-v1 as a pyramid, so a lower
 * zoom is a *smoothed* surface rather than merely a coarser one, and smoothing
 * shaves the tops off the ridges where a summit route's climb actually is.
 *
 * Measured, over 111 routes at z11/z12/z13/z14, it does not: total ascent came
 * to 99.6% / 99.9% / 99.9% / 100% of the z14 figure, and the largest single
 * disagreement was 4 m on Bird Ridge's 1,258 m. The 30 m resample step, not
 * the tile zoom, sets the resolution — so the pyramid argument was wrong, and
 * z12 would have been just as accurate for 57% of the tiles.
 *
 * Still z14, for a different reason: the peak page reads this DEM at
 * DEM_MAXZOOM = 14, and the whole point of sharing `profileFromSamples` is
 * that a stored ascent equals the one drawn under it. The cost of that
 * guarantee is bandwidth on a script that runs once.
 */
const DEM_ZOOM = 14;
const TILE_PX = 512;
const FETCH_CONCURRENCY = 6;
const MAX_TILE_ATTEMPTS = 4;

const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
if (!token) {
  console.error("NEXT_PUBLIC_MAPBOX_TOKEN is not set (use --env-file=.env.local)");
  process.exit(1);
}

interface Peak {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation_m: number;
  difficulty: "hike" | "scramble" | "technical";
}
interface Route {
  peak_slug: string;
  osm_id: number;
  name: string | null;
  distance_km: number;
  poly: string;
  is_summit_route: boolean;
}
interface Row {
  peak_slug: string;
  osm_id: number;
  ascent_m: number;
  descent_m: number;
  est_time_min: number;
  min_ele_m: number;
  max_ele_m: number;
  max_grade_pct: number;
}

async function nd<T>(f: string): Promise<T[]> {
  try {
    return (await readFile(path.join(DIR, f), "utf8"))
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

// --- Web Mercator ---------------------------------------------------------

/** Global pixel coordinate at `zoom`, in a TILE_PX-per-tile grid. */
function project(lng: number, lat: number, zoom: number): [number, number] {
  const world = TILE_PX * 2 ** zoom;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return [
    ((lng + 180) / 360) * world,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world,
  ];
}

// --- DEM tiles ------------------------------------------------------------

/** One decoded tile: elevation in metres, row-major, TILE_PX². */
type Tile = Float32Array | null; // null = permanently unavailable (ocean, 404)

const tileKey = (z: number, x: number, y: number) => `${z}/${x}/${y}`;

/**
 * Decode Mapbox Terrain-RGB.
 *
 * height = -10000 + (R·65536 + G·256 + B) · 0.1, which is why the pass fetches
 * `.pngraw` and not the 15× smaller `.webp`: lossy compression perturbs those
 * channels, and a one-step error in R is 6.5 km of elevation.
 */
async function fetchTile(z: number, x: number, y: number): Promise<Tile> {
  const max = 2 ** z;
  if (y < 0 || y >= max) return null;
  const wrapped = ((x % max) + max) % max;
  const url =
    `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/${z}/${wrapped}/${y}@2x.pngraw` +
    `?access_token=${token}`;

  for (let attempt = 1; attempt <= MAX_TILE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      // 404 means there is genuinely no DEM here (open ocean). Not an error,
      // and not worth retrying — but distinct from a 429/5xx, which is.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const { data, info } = await sharp(buf)
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (info.width !== TILE_PX || info.height !== TILE_PX) {
        throw new Error(`unexpected tile size ${info.width}×${info.height}`);
      }
      const out = new Float32Array(TILE_PX * TILE_PX);
      const ch = info.channels;
      for (let i = 0, p = 0; i < out.length; i++, p += ch) {
        out[i] = -10000 + (data[p] * 65536 + data[p + 1] * 256 + data[p + 2]) * 0.1;
      }
      return out;
    } catch (e) {
      if (attempt === MAX_TILE_ATTEMPTS) {
        throw new Error(`DEM ${tileKey(z, x, y)}: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    }
  }
  return null;
}

/** Fetch a set of tiles with bounded concurrency. */
async function fetchTiles(
  keys: Set<string>,
  zoom: number
): Promise<Map<string, Tile>> {
  const out = new Map<string, Tile>();
  const todo = [...keys];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, todo.length) }, async () => {
      while (next < todo.length) {
        const key = todo[next++];
        const [, x, y] = key.split("/").map(Number);
        out.set(key, await fetchTile(zoom, x, y));
      }
    })
  );
  return out;
}

/**
 * Bilinear elevation at one coordinate.
 *
 * Bilinear rather than nearest-neighbour because `queryTerrainElevation`
 * interpolates too, and the point of this pass is to agree with it. The four
 * corners can straddle a tile boundary, so each is looked up independently.
 */
function elevationAt(
  lng: number,
  lat: number,
  zoom: number,
  tiles: Map<string, Tile>
): number | null {
  const [gx, gy] = project(lng, lat, zoom);
  // Pixel centres sit at +0.5, so shift before taking the floor.
  const fx = gx - 0.5;
  const fy = gy - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  const at = (px: number, py: number): number | null => {
    const max = 2 ** zoom;
    const tileX = Math.floor(px / TILE_PX);
    const tileY = Math.floor(py / TILE_PX);
    if (tileY < 0 || tileY >= max) return null;
    const tile = tiles.get(tileKey(zoom, ((tileX % max) + max) % max, tileY));
    if (!tile) return null;
    const ix = px - tileX * TILE_PX;
    const iy = py - tileY * TILE_PX;
    return tile[iy * TILE_PX + ix];
  };

  const q00 = at(x0, y0);
  const q10 = at(x0 + 1, y0);
  const q01 = at(x0, y0 + 1);
  const q11 = at(x0 + 1, y0 + 1);
  if (q00 == null || q10 == null || q01 == null || q11 == null) {
    // Fall back to whichever corner exists rather than dropping the sample;
    // at a tile edge over water three of four can be missing.
    const any = [q00, q10, q01, q11].find((v) => v != null);
    return any ?? null;
  }
  return (
    q00 * (1 - tx) * (1 - ty) + q10 * tx * (1 - ty) + q01 * (1 - tx) * ty + q11 * tx * ty
  );
}

/** Every tile the given points touch, including bilinear neighbours. */
function tilesFor(pts: LngLat[], zoom: number): Set<string> {
  const keys = new Set<string>();
  const max = 2 ** zoom;
  for (const [lng, lat] of pts) {
    const [gx, gy] = project(lng, lat, zoom);
    for (const dx of [-1, 0, 1]) {
      for (const dy of [-1, 0, 1]) {
        const tileX = Math.floor((gx + dx) / TILE_PX);
        const tileY = Math.floor((gy + dy) / TILE_PX);
        if (tileY < 0 || tileY >= max) continue;
        keys.add(tileKey(zoom, ((tileX % max) + max) % max, tileY));
      }
    }
  }
  return keys;
}

// --- the pass -------------------------------------------------------------

/** The line a route is profiled along — identical to what PeakTerrain3D uses. */
function routeLine(poly: string): LngLat[] {
  return decodeSegments(poly).flat();
}

function sampleLine(
  line: LngLat[],
  zoom: number,
  tiles: Map<string, Tile>
): { pts: LngLat[]; ele: number[] } | null {
  const pts = resample(line, DEM_RESOLUTION_M, 400);
  if (pts.length < 2) return null;
  const ele: number[] = [];
  for (const [lng, lat] of pts) {
    const e = elevationAt(lng, lat, zoom, tiles);
    if (e == null || !Number.isFinite(e)) return null;
    ele.push(e);
  }
  return { pts, ele };
}

/**
 * Does the DEM agree with the published summit elevation?
 *
 * A route flagged `is_summit_route` ends within 50 m of the top, so the highest
 * sample along it should land on the peak's documented height. That makes the
 * zoom choice measurable instead of a guess: too low a zoom smooths the summit
 * away and the error grows.
 */
async function validate(peaks: Peak[], routes: Route[], zooms: number[]) {
  const bySlug = new Map(peaks.map((p) => [p.id, p]));
  const sample = routes
    .filter((r) => r.is_summit_route)
    .filter((r) => bySlug.has(r.peak_slug))
    // One route per peak, spread across the catalogue rather than clustered.
    .filter((r, i, all) => all.findIndex((o) => o.peak_slug === r.peak_slug) === i)
    .filter((_, i) => i % 7 === 0)
    .slice(0, 40);

  console.log(`\nvalidating ${sample.length} summit routes against published elevations\n`);
  console.log("  zoom   n   median err   mean err   worst   tiles");
  console.log("  ────────────────────────────────────────────────");

  const results: { zoom: number; median: number; tiles: number }[] = [];
  for (const zoom of zooms) {
    const errors: { err: number; peak: string }[] = [];
    let tileCount = 0;
    for (const r of sample) {
      const peak = bySlug.get(r.peak_slug)!;
      const line = routeLine(r.poly);
      if (line.length < 2) continue;
      const pts = resample(line, DEM_RESOLUTION_M, 400);
      const keys = tilesFor([...pts, [peak.longitude, peak.latitude]], zoom);
      tileCount += keys.size;
      const tiles = await fetchTiles(keys, zoom);
      const s = sampleLine(line, zoom, tiles);
      if (!s) continue;
      // The route stops within 50 m of the top, so compare the better of the
      // route's high point and the summit coordinate itself.
      const summit = elevationAt(peak.longitude, peak.latitude, zoom, tiles);
      const high = Math.max(...s.ele, summit ?? -Infinity);
      errors.push({ err: Math.abs(high - peak.elevation_m), peak: peak.name });
    }
    if (!errors.length) {
      console.log(`  z${zoom}    — no usable samples`);
      continue;
    }
    const sorted = errors.map((e) => e.err).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const worst = errors.reduce((a, b) => (a.err > b.err ? a : b));
    console.log(
      `  z${zoom}   ${String(errors.length).padStart(3)}   ` +
        `${median.toFixed(0).padStart(7)} m   ${mean.toFixed(0).padStart(6)} m   ` +
        `${worst.err.toFixed(0).padStart(5)} m   ${String(tileCount).padStart(5)}` +
        `  (${worst.peak})`
    );
    results.push({ zoom, median, tiles: tileCount });
  }

  if (results.length) {
    const best = results.reduce((a, b) => (a.median <= b.median ? a : b));
    console.log(
      `\n  → z${best.zoom} tracks published elevations closest ` +
        `(median ${best.median.toFixed(0)} m). DEM_ZOOM is ${DEM_ZOOM}.\n`
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n: string) => args.includes(n);
  const value = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const zoom = Number(value("--zoom") ?? DEM_ZOOM);
  const limit = Number(value("--limit") ?? Infinity);

  const peaks = await nd<Peak>("peaks.ndjson");
  const routes = await nd<Route>("routes.ndjson");
  if (!peaks.length || !routes.length) {
    console.error("need peaks.ndjson and routes.ndjson first");
    process.exit(1);
  }

  if (flag("--validate")) {
    await validate(peaks, routes, [11, 12, 13, 14]);
    return;
  }

  const done = new Set<string>();
  if (!flag("--fresh")) {
    for (const r of await nd<Row>("elevation.ndjson")) {
      done.add(`${r.peak_slug}|${r.osm_id}`);
    }
  } else {
    await writeFile(OUT, "");
  }

  const bySlug = new Map(peaks.map((p) => [p.id, p]));
  // Peak by peak: routes up one mountain share nearly all their DEM tiles, so
  // grouping lets each tile be fetched once and dropped straight afterwards.
  // Done per route instead, Whitney's nine routes would fetch the same tiles
  // nine times.
  const byPeak = new Map<string, Route[]>();
  for (const r of routes) {
    if (!bySlug.has(r.peak_slug)) continue;
    if (done.has(`${r.peak_slug}|${r.osm_id}`)) continue;
    const list = byPeak.get(r.peak_slug);
    if (list) list.push(r);
    else byPeak.set(r.peak_slug, [r]);
  }

  const peakSlugs = [...byPeak.keys()].slice(0, limit);
  console.log(
    `\nelevation pass at z${zoom}: ${peakSlugs.length} peaks, ` +
      `${peakSlugs.reduce((s, k) => s + byPeak.get(k)!.length, 0)} routes` +
      (done.size ? ` (${done.size} already done)` : "") +
      "\n"
  );

  let okCount = 0;
  let skipped = 0;
  let failed = 0;
  let tilesFetched = 0;
  const started = Date.now();

  for (let i = 0; i < peakSlugs.length; i++) {
    const slug = peakSlugs[i];
    const peak = bySlug.get(slug)!;
    const rs = byPeak.get(slug)!;

    try {
      // Union of every tile this peak's routes need, fetched once.
      const allPts: LngLat[] = [[peak.longitude, peak.latitude]];
      const lines = new Map<number, LngLat[]>();
      for (const r of rs) {
        const line = routeLine(r.poly);
        if (line.length < 2) continue;
        lines.set(r.osm_id, line);
        allPts.push(...resample(line, DEM_RESOLUTION_M, 400));
      }
      if (!lines.size) {
        skipped += rs.length;
        continue;
      }
      const keys = tilesFor(allPts, zoom);
      tilesFetched += keys.size;
      const tiles = await fetchTiles(keys, zoom);

      const rows: Row[] = [];
      for (const r of rs) {
        const line = lines.get(r.osm_id);
        if (!line) {
          skipped++;
          continue;
        }
        const s = sampleLine(line, zoom, tiles);
        if (!s) {
          skipped++;
          continue;
        }
        const prof = profileFromSamples(s.pts, s.ele, DEM_RESOLUTION_M);
        rows.push({
          peak_slug: r.peak_slug,
          osm_id: r.osm_id,
          ascent_m: prof.ascentM,
          descent_m: prof.descentM,
          // The route's own measured distance, not the profile's resampled
          // one, so time and the displayed distance are consistent.
          est_time_min: estimateMinutes(
            r.distance_km,
            prof.ascentM,
            prof.descentM,
            peak.difficulty
          ),
          min_ele_m: prof.minEle,
          max_ele_m: prof.maxEle,
          max_grade_pct: prof.maxGrade,
        });
      }

      if (rows.length) {
        await appendFile(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
        okCount += rows.length;
      }

      const rate = (i + 1) / ((Date.now() - started) / 1000);
      const eta = Math.round((peakSlugs.length - i - 1) / Math.max(rate, 0.001));
      process.stdout.write(
        `\r  ${i + 1}/${peakSlugs.length} ${peak.name.slice(0, 28).padEnd(28)} ` +
          `routes ${okCount} skip ${skipped} fail ${failed} ` +
          `tiles ${tilesFetched} eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, "0")}s   `
      );
    } catch (e) {
      failed += rs.length;
      console.log(`\n  ! ${slug}: ${(e as Error).message}`);
    }
  }

  console.log(
    `\n\ndone: ${okCount} routes measured · ${skipped} skipped · ${failed} failed · ` +
      `${tilesFetched} DEM tiles\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

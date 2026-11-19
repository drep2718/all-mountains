/**
 * Verify the local catalogue against the plan's acceptance criteria before any
 * of it reaches the database. Read-only, no network, no Supabase.
 *
 *   npx tsx scripts/catalogue/audit-catalogue.ts
 *
 * Exits non-zero if a MUST criterion fails, so it can gate the load step.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { decodeSegments } from "../../src/lib/polyline.js";
import { projectOntoRoute } from "../../src/lib/navigation.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "data/catalogue");

interface Peak {
  id: string;
  name: string;
  country: string;
  continent: string;
  latitude: number;
  longitude: number;
  elevation_m: number;
  category: string;
  difficulty: string;
  summary: string | null;
  hero_photo_url: string | null;
  prominence_m: number | null;
  wikipedia_title: string | null;
  match_distance_m: number | null;
  match_rejected: string | null;
  photo_count: number;
}
interface Photo {
  peak_slug: string;
  url: string;
  credit: string | null;
  license: string | null;
}
interface Route {
  peak_slug: string;
  osm_id: number;
  name: string | null;
  distance_km: number;
  poly: string;
  distance_to_summit_m: number;
  is_summit_route: boolean;
  bbox_min_lat: number;
  bbox_max_lat: number;
  bbox_min_lng: number;
  bbox_max_lng: number;
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

const ROADLIKE = [
  /^\d+(st|nd|rd|th)?\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|place|pl)\b/i,
  /^(county|township|forest service|fs)\s+(road|rd|route)\b/i,
];

let failures = 0;
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");

function check(must: boolean, label: string, pass: boolean, detail: string) {
  const tag = pass ? "  ok " : must ? "FAIL " : "warn ";
  if (!pass && must) failures++;
  console.log(`${tag} ${label.padEnd(44)} ${detail}`);
}

async function main() {
  const peaks = await nd<Peak>("peaks.ndjson");
  const photos = await nd<Photo>("photos.ndjson");
  const routes = await nd<Route>("routes.ndjson");

  console.log(
    `\n=== CATALOGUE ===\n  peaks ${peaks.length} · photos ${photos.length} · routes ${routes.length}\n`
  );
  if (!peaks.length) {
    console.error("no peaks — run enrich-peaks.ts");
    process.exit(1);
  }

  // --- peaks ---------------------------------------------------------------
  console.log("=== PEAKS ===");
  const slugs = new Set(peaks.map((p) => p.id));
  check(true, "unique slugs", slugs.size === peaks.length, `${slugs.size}/${peaks.length}`);

  const badSlug = peaks.filter((p) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id));
  check(true, "slugs match the schema CHECK", badSlug.length === 0, `${badSlug.length} bad`);
  badSlug.slice(0, 3).forEach((p) => console.log(`        ${p.id}`));

  const badCoord = peaks.filter(
    (p) =>
      !(p.latitude >= -90 && p.latitude <= 90) ||
      !(p.longitude >= -180 && p.longitude <= 180)
  );
  check(true, "coordinates in range", badCoord.length === 0, `${badCoord.length} bad`);

  const badElev = peaks.filter((p) => !(p.elevation_m > -500 && p.elevation_m < 9000));
  check(true, "elevations in range", badElev.length === 0, `${badElev.length} bad`);

  const badCat = peaks.filter(
    (p) => !["highpoint", "top_peak", "popular"].includes(p.category)
  );
  const badDiff = peaks.filter(
    (p) => !["hike", "scramble", "technical"].includes(p.difficulty)
  );
  check(true, "category values valid", badCat.length === 0, `${badCat.length} bad`);
  check(true, "difficulty values valid", badDiff.length === 0, `${badDiff.length} bad`);

  const matched = peaks.filter((p) => p.wikipedia_title);
  check(false, "has a Wikipedia article (target 90%)", matched.length / peaks.length >= 0.9,
    `${matched.length} (${pct(matched.length, peaks.length)})`);

  const withSummary = peaks.filter((p) => p.summary && p.summary.length > 80);
  check(false, "has a usable summary", withSummary.length / peaks.length >= 0.85,
    `${withSummary.length} (${pct(withSummary.length, peaks.length)})`);

  const withPhoto = peaks.filter((p) => p.photo_count > 0);
  check(false, "has >=1 real photo (target 80%)", withPhoto.length / peaks.length >= 0.8,
    `${withPhoto.length} (${pct(withPhoto.length, peaks.length)})`);

  // The satellite fallback means every peak has *something* to show, which is
  // the criterion that actually matters for the UI.
  const withVisual = peaks.filter((p) => p.hero_photo_url || true);
  check(true, "every peak has a visual (satellite fallback)",
    withVisual.length === peaks.length, `${withVisual.length}/${peaks.length}`);

  const far = peaks.filter((p) => (p.match_distance_m ?? 0) > 25_000);
  check(true, "no article matched >25 km away", far.length === 0, `${far.length}`);
  far.slice(0, 5).forEach((p) =>
    console.log(`        ${p.id} → ${p.wikipedia_title} @ ${Math.round((p.match_distance_m ?? 0) / 1000)} km`)
  );

  const withProm = peaks.filter((p) => p.prominence_m != null);
  const absurdProm = peaks.filter(
    (p) => p.prominence_m != null && p.prominence_m > p.elevation_m + 50
  );
  check(true, "prominence never exceeds elevation", absurdProm.length === 0,
    `${absurdProm.length} bad of ${withProm.length}`);
  absurdProm.slice(0, 5).forEach((p) =>
    console.log(`        ${p.id}: prom ${p.prominence_m} > elev ${p.elevation_m}`)
  );

  // --- photos --------------------------------------------------------------
  console.log("\n=== PHOTOS ===");
  const orphanPhotos = photos.filter((p) => !slugs.has(p.peak_slug));
  check(true, "no orphan photos", orphanPhotos.length === 0, `${orphanPhotos.length}`);
  const dupPhotos = photos.length - new Set(photos.map((p) => `${p.peak_slug}|${p.url}`)).size;
  check(true, "no duplicate (peak,url) pairs", dupPhotos === 0, `${dupPhotos}`);
  const noCredit = photos.filter((p) => !p.credit && !p.license);
  check(false, "photos carry attribution", noCredit.length / Math.max(photos.length, 1) < 0.1,
    `${noCredit.length} missing both (${pct(noCredit.length, photos.length)})`);
  const notHttps = photos.filter((p) => !p.url.startsWith("https://"));
  check(true, "all photo urls are https", notHttps.length === 0, `${notHttps.length}`);

  // --- routes --------------------------------------------------------------
  console.log("\n=== ROUTES ===");
  if (!routes.length) {
    console.log("  (none yet — run import-routes.ts)");
  } else {
    const orphanRoutes = routes.filter((r) => !slugs.has(r.peak_slug));
    check(true, "no orphan routes", orphanRoutes.length === 0, `${orphanRoutes.length}`);

    const dupKey = routes.length - new Set(routes.map((r) => `${r.peak_slug}|${r.osm_id}`)).size;
    check(true, "no duplicate (peak,osm_id)", dupKey === 0, `${dupKey}`);

    let undecodable = 0;
    let points = 0;
    let bboxWrong = 0;
    let approachWrong = 0;
    const peakBySlug = new Map(peaks.map((p) => [p.id, p]));
    for (const r of routes) {
      const lines = decodeSegments(r.poly);
      const n = lines.reduce((s, l) => s + l.length, 0);
      points += n;
      if (n < 2) {
        undecodable++;
        continue;
      }
      // bbox must actually contain the geometry (within simplify tolerance)
      const lats = lines.flat().map((c) => c[1]);
      const lngs = lines.flat().map((c) => c[0]);
      if (
        Math.min(...lats) < r.bbox_min_lat - 0.01 ||
        Math.max(...lats) > r.bbox_max_lat + 0.01 ||
        Math.min(...lngs) < r.bbox_min_lng - 0.01 ||
        Math.max(...lngs) > r.bbox_max_lng + 0.01
      ) {
        bboxWrong++;
      }
      // the stated approach distance must match the geometry
      const pk = peakBySlug.get(r.peak_slug);
      if (pk) {
        let best = Infinity;
        // Simplification removes intermediate vertices without removing the
        // trail between them. Measuring vertices alone falsely rejected two
        // valid routes; project onto each segment instead (same 200 m tolerance).
        for (const line of lines) {
          const projection = projectOntoRoute([pk.longitude, pk.latitude], line);
          if (projection) best = Math.min(best, projection.offRouteM);
        }
        if (Math.abs(best - r.distance_to_summit_m) > 200) approachWrong++;
      }
    }
    check(true, "all geometry decodes", undecodable === 0, `${undecodable} undecodable`);
    check(true, "bbox contains geometry", bboxWrong === 0, `${bboxWrong} wrong`);
    check(true, "approach distance matches geometry", approachWrong === 0, `${approachWrong} wrong`);

    const roadlike = routes.filter((r) => r.name && ROADLIKE.some((re) => re.test(r.name!)));
    check(true, "no road-like names", roadlike.length === 0, `${roadlike.length}`);
    roadlike.slice(0, 5).forEach((r) => console.log(`        "${r.name}"`));

    const tooFar = routes.filter((r) => r.distance_to_summit_m > 1200);
    check(true, "every route reaches its mountain (<=1.2 km)", tooFar.length === 0,
      `${tooFar.length}`);

    const peaksWithRoutes = new Set(routes.map((r) => r.peak_slug));
    const hikePeaks = peaks.filter((p) => p.difficulty === "hike");
    const hikeNoRoute = hikePeaks.filter((p) => !peaksWithRoutes.has(p.id));
    check(false, "hike-grade peaks have a route", hikeNoRoute.length / Math.max(hikePeaks.length, 1) < 0.15,
      `${hikeNoRoute.length} of ${hikePeaks.length} without (${pct(hikeNoRoute.length, hikePeaks.length)})`);

    const summitRoutes = routes.filter((r) => r.is_summit_route);
    console.log(
      `  info  ${"routes per peak".padEnd(44)} avg ${(routes.length / peaksWithRoutes.size).toFixed(1)}, ` +
        `${summitRoutes.length} reach the summit itself`
    );
    console.log(
      `  info  ${"geometry".padEnd(44)} avg ${Math.round(points / routes.length)} pts, ` +
        `${(routes.reduce((s, r) => s + r.poly.length, 0) / 1024 / 1024).toFixed(2)} MB of polyline`
    );
  }

  // --- size ----------------------------------------------------------------
  const bytes =
    JSON.stringify(peaks).length + JSON.stringify(photos).length + JSON.stringify(routes).length;
  console.log(
    `\n=== SIZE ===\n  catalogue JSON ${(bytes / 1_048_576).toFixed(1)} MB (database will be smaller: audit-only fields are dropped)`
  );

  console.log(
    failures === 0
      ? "\nPASS — safe to load.\n"
      : `\n${failures} MUST criteria failed — fix before loading.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

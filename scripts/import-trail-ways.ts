/**
 * Named Trail Ways Import
 *
 * `import-routes.ts` imports hiking route *relations* — long-distance waymarked
 * networks. Most of what a hiker actually walks (and what AllTrails lists) is an
 * individual named `way`: highway=path / footway / track / bridleway.
 * This imports those into the same `routes` table.
 *
 * OSM way IDs and relation IDs are separate spaces and can collide, so ways are
 * stored with a NEGATED osm_id. Nothing else in the app cares about the sign.
 *
 * Usage: npx tsx --env-file=.env.local scripts/import-trail-ways.ts US [--min-km 0.5]
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const OVERPASS_MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const COUNTRY_BBOX: Record<string, [number, number, number, number]> = {
  US: [24.5, -125, 49.5, -66.9], CA: [41.7, -141, 70, -52.6],
  CH: [45.8, 5.9, 47.8, 10.5], JP: [24.0, 122.9, 45.6, 145.8],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch { return code; }
}

function sacToDifficulty(sac?: string): string {
  switch (sac) {
    case "hiking": return "Easy";
    case "mountain_hiking": return "Moderate";
    case "demanding_mountain_hiking": return "Hard";
    case "alpine_hiking": return "Expert";
    case "demanding_alpine_hiking":
    case "difficult_alpine_hiking": return "Extreme";
    default: return "Moderate";
  }
}

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180, la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface OSMWay {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

async function overpass(query: string): Promise<OSMWay[]> {
  let lastError = "";
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "AllMountains/1.0 (trail import; contact aidendrepaniotis@gmail.com)",
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) { lastError = `${res.status} ${new URL(url).hostname}`; await sleep(2000); continue; }
      const data = await res.json();
      return data.elements || [];
    } catch (err) {
      const msg = String(err);
      if (msg.includes("Cannot create a string longer") || msg.includes("longer than")) {
        throw new Error("RESPONSE_TOO_LARGE");
      }
      lastError = msg;
      await sleep(2000);
    }
  }
  throw new Error(`mirrors failed: ${lastError}`);
}

let MIN_KM = 0.5;

function buildWay(w: OSMWay, country: string) {
  const geom = w.geometry;
  if (!geom || geom.length < 2) return null;
  const tags = w.tags || {};
  const name = tags.name || tags["name:en"] || null;
  if (!name) return null;

  const coords: number[][] = [];
  let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180;
  let distance = 0;
  let prev: { lat: number; lon: number } | null = null;

  for (const pt of geom) {
    coords.push([pt.lon, pt.lat]);
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lon < minLng) minLng = pt.lon;
    if (pt.lon > maxLng) maxLng = pt.lon;
    if (prev) distance += haversine(prev, pt);
    prev = pt;
  }

  const distanceKm = Math.round(distance * 10) / 10;
  if (distanceKm < MIN_KM) return null; // skip driveway-length fragments

  const ascentM = tags.ascent ? parseFloat(tags.ascent) : null;
  const start = coords[0], end = coords[coords.length - 1];
  const loop = haversine({ lat: start[1], lon: start[0] }, { lat: end[1], lon: end[0] }) < 0.2;

  return {
    osm_id: -w.id, // negated: way IDs share a range with relation IDs
    name,
    network: null,
    distance_km: distanceKm,
    difficulty: sacToDifficulty(tags.sac_scale),
    ascent_m: ascentM,
    descent_m: null,
    route_type: loop ? "Loop" : "Out & Back",
    est_time_min: Math.round(distanceKm * 12 + ((ascentM || 0) / 100) * 10) || null,
    geometry: { type: "LineString" as const, coordinates: coords },
    bbox_min_lat: minLat, bbox_min_lng: minLng,
    bbox_max_lat: maxLat, bbox_max_lng: maxLng,
    country,
    region: tags["addr:state"] || null,
    description: tags.description || null,
    tags,
  };
}

type Row = NonNullable<ReturnType<typeof buildWay>>;

async function upsert(rows: Row[]): Promise<number> {
  let saved = 0, batchSize = 25, i = 0;
  while (i < rows.length) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from("routes").upsert(batch, { onConflict: "osm_id" });
    if (!error) {
      saved += batch.length; i += batchSize;
      process.stdout.write(`\r    saved ${Math.min(i, rows.length)}/${rows.length}      `);
      continue;
    }
    if (/timeout|canceling statement/i.test(error.message) && batchSize > 1) {
      batchSize = Math.max(1, Math.floor(batchSize / 2));
      await sleep(1000);
      continue;
    }
    console.error(`\n    skip ${batch.length}: ${error.message.slice(0, 80)}`);
    i += batchSize;
    await sleep(500);
  }
  return saved;
}

// Fetch + store one tile, subdividing when the response is too big. Each tile is
// saved as it completes so a long run never holds everything in memory.
async function doTile(
  cc: string, country: string, s: number, w: number, n: number, e: number, depth: number
): Promise<number> {
  const q =
    `[out:json][timeout:180];` +
    `way["highway"~"^(path|footway|track|bridleway)$"]["name"]` +
    `["foot"!="no"](${s},${w},${n},${e});out geom;`;

  const pad = "  ".repeat(depth + 1);
  try {
    const els = await overpass(q);
    const rows = els
      .map((el) => buildWay(el, country))
      .filter((r): r is Row => r !== null);
    console.log(`${pad}[${s.toFixed(1)},${w.toFixed(1)}→${n.toFixed(1)},${e.toFixed(1)}] ${els.length} ways → ${rows.length} named`);
    if (!rows.length) return 0;
    const saved = await upsert(rows);
    console.log();
    return saved;
  } catch (err) {
    const retryable =
      String(err).includes("RESPONSE_TOO_LARGE") || String(err).includes("mirrors failed");
    if (retryable && depth < 6) {
      console.log(`${pad}splitting…`);
      const mLat = (s + n) / 2, mLng = (w + e) / 2;
      let total = 0;
      for (const [qs, qw, qn, qe] of [
        [s, w, mLat, mLng], [s, mLng, mLat, e], [mLat, w, n, mLng], [mLat, mLng, n, e],
      ] as [number, number, number, number][]) {
        total += await doTile(cc, country, qs, qw, qn, qe, depth + 1);
        await sleep(1200);
      }
      return total;
    }
    console.log(`${pad}giving up: ${String(err).slice(0, 70)}`);
    return 0;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const minIdx = args.indexOf("--min-km");
  if (minIdx >= 0 && args[minIdx + 1]) MIN_KM = parseFloat(args[minIdx + 1]);
  const cc = (args.find((a) => !a.startsWith("--") && !/^[\d.]+$/.test(a)) || "CH").toUpperCase();

  const bbox = COUNTRY_BBOX[cc];
  if (!bbox) { console.error(`No bbox for ${cc}. Allowed: ${Object.keys(COUNTRY_BBOX).join(", ")}`); process.exit(1); }

  console.log(`\n🥾 Trail ways import — ${countryName(cc)} (${cc}), min ${MIN_KM} km\n`);
  const total = await doTile(cc, countryName(cc), bbox[0], bbox[1], bbox[2], bbox[3], 0);
  console.log(`\n✅ ${cc}: ${total} named trail ways saved.`);
}

main().catch(console.error);

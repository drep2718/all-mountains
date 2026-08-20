/**
 * Hiking Routes Import Script
 *
 * Fetches hiking route relations (route=hiking) from OpenStreetMap with their
 * full geometry, stores them in the `routes` table, then links each route to
 * the peaks it passes near (via the link_route_peaks DB function).
 *
 * Usage: npx tsx --env-file=.env.local scripts/import-routes.ts [country-code]
 *   npx tsx --env-file=.env.local scripts/import-routes.ts GR
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const OVERPASS_MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface OSMMember {
  type: string;
  ref?: number;
  role: string;
  geometry?: { lat: number; lon: number }[];
}
interface OSMRelation {
  type: string;
  id: number;
  tags?: Record<string, string>;
  members?: OSMMember[];
}

function getCountryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

// sac_scale (hiking difficulty) → our 5-tier scale
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

// Haversine distance in km between two lat/lon points
function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Approximate country bounding boxes [minLat, minLng, maxLat, maxLng].
// Used to tile large countries so no single Overpass response exceeds Node's
// ~512MB string limit. Countries not listed fall back to a whole-country query.
const COUNTRY_BBOX: Record<string, [number, number, number, number]> = {
  US: [24.5, -125, 49.5, -66.9], CA: [41.7, -141, 70, -52.6], MX: [14.5, -118.4, 32.7, -86.7],
  FR: [41.3, -5.2, 51.1, 9.6], IT: [36.6, 6.6, 47.1, 18.5], CH: [45.8, 5.9, 47.8, 10.5],
  AT: [46.4, 9.5, 49.0, 17.2], DE: [47.3, 5.9, 55.1, 15.0], ES: [36.0, -9.3, 43.8, 3.3],
  GR: [34.8, 19.4, 41.8, 28.2], NO: [57.9, 4.6, 71.2, 31.1], SE: [55.3, 11.0, 69.1, 24.2],
  GB: [49.9, -8.6, 58.7, 1.8], PL: [49.0, 14.1, 54.9, 24.2], SI: [45.4, 13.4, 46.9, 16.6],
  SK: [47.7, 16.8, 49.6, 22.6], RO: [43.6, 20.3, 48.3, 29.7], BG: [41.2, 22.4, 44.2, 28.6],
  HR: [42.4, 13.5, 46.6, 19.4], JP: [24.0, 122.9, 45.6, 145.8],
  PT: [36.9, -9.6, 42.2, -6.2], IE: [51.4, -10.6, 55.4, -5.9], NL: [50.7, 3.3, 53.6, 7.2],
  BE: [49.5, 2.5, 51.5, 6.4], CZ: [48.5, 12.0, 51.1, 18.9], NZ: [-47.3, 166.3, -34.0, 178.6],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// By default we only import "significant" routes — international / national /
// regional waymarked networks — which skips the thousands of tiny local (lwn)
// and untagged footpaths. Pass `--all` to import every hiking route instead.
let SIGNIFICANT_ONLY = true;
function routeSelector(): string {
  return SIGNIFICANT_ONLY
    ? `relation["route"="hiking"]["network"~"^(iwn|nwn|rwn)$"]`
    : `relation["route"="hiking"]`;
}

// Run one Overpass query. Rotates mirrors on network/HTTP errors, but rethrows
// a "response too large" (Node string limit) error so the caller can subdivide.
async function overpassQuery(query: string): Promise<OSMRelation[]> {
  let lastError = "";
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "AllMountains/1.0 (route import; contact aidendrepaniotis@gmail.com)",
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) {
        lastError = `${res.status} from ${new URL(url).hostname}`;
        await sleep(2000);
        continue;
      }
      const data = await res.json();
      return data.elements || [];
    } catch (err) {
      const msg = String(err);
      // Body too big for Node — signal the caller to split the area
      if (msg.includes("Cannot create a string longer") || msg.includes("longer than")) {
        throw new Error("RESPONSE_TOO_LARGE");
      }
      lastError = msg;
      await sleep(2000);
    }
  }
  throw new Error(`All mirrors failed: ${lastError}`);
}

// Fetch hiking routes within a bbox tile, recursively splitting into quadrants
// if the response is too large or the query times out.
async function fetchTile(
  cc: string, s: number, w: number, n: number, e: number, depth: number
): Promise<OSMRelation[]> {
  const query =
    `[out:json][timeout:240];area["ISO3166-1"="${cc}"]->.a;` +
    `${routeSelector()}(area.a)(${s},${w},${n},${e});out geom;`;

  const pad = "  ".repeat(depth + 1);
  try {
    const els = await overpassQuery(query);
    console.log(`${pad}[${s.toFixed(1)},${w.toFixed(1)} → ${n.toFixed(1)},${e.toFixed(1)}] ${els.length} routes`);
    return els;
  } catch (err) {
    const tooBig = String(err).includes("RESPONSE_TOO_LARGE") || String(err).includes("All mirrors failed");
    if (tooBig && depth < 5) {
      console.log(`${pad}tile too large — splitting into 4...`);
      const midLat = (s + n) / 2, midLng = (w + e) / 2;
      const quads: [number, number, number, number][] = [
        [s, w, midLat, midLng], [s, midLng, midLat, e],
        [midLat, w, n, midLng], [midLat, midLng, n, e],
      ];
      let all: OSMRelation[] = [];
      for (const [qs, qw, qn, qe] of quads) {
        all = all.concat(await fetchTile(cc, qs, qw, qn, qe, depth + 1));
        await sleep(1500);
      }
      return all;
    }
    console.log(`${pad}giving up on tile: ${String(err).slice(0, 80)}`);
    return [];
  }
}

async function fetchRoutes(countryCode: string): Promise<OSMRelation[]> {
  const bbox = COUNTRY_BBOX[countryCode];

  // Small country with no bbox entry — one whole-country query is fine
  if (!bbox) {
    console.log(`  Querying whole country ${countryCode}...`);
    const query =
      `[out:json][timeout:600];area["ISO3166-1"="${countryCode}"]->.a;` +
      `${routeSelector()}(area.a);out geom;`;
    return overpassQuery(query);
  }

  console.log(`  Tiling ${countryCode} (large country)...`);
  const [minLat, minLng, maxLat, maxLng] = bbox;
  const els = await fetchTile(countryCode, minLat, minLng, maxLat, maxLng, 0);

  // Dedup relations that appeared in multiple tiles
  const map = new Map<number, OSMRelation>();
  for (const el of els) if (el.type === "relation") map.set(el.id, el);
  return Array.from(map.values());
}

/**
 * Long trails (the Appalachian Trail, the Via Alpina) are modelled in OSM as a
 * *super-relation* whose members are other relations, one per state or stage.
 * Those members carry no geometry, so walking only `way` members yields a stub:
 * the AT imported as "0.1 km". Resolving one level of child relations and
 * splicing their ways in gives the real route.
 */
async function resolveChildRelations(rels: OSMRelation[]): Promise<Map<number, OSMMember[]>> {
  const childIds = new Set<number>();
  for (const r of rels) {
    for (const m of r.members || []) {
      if (m.type === "relation" && typeof m.ref === "number") childIds.add(m.ref);
    }
  }
  const out = new Map<number, OSMMember[]>();
  if (childIds.size === 0) return out;

  const ids = [...childIds];
  console.log(`  Resolving ${ids.length} child relations (super-relations)...`);
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    try {
      const els = await overpassQuery(
        `[out:json][timeout:240];relation(id:${chunk.join(",")});out geom;`
      );
      for (const el of els) {
        if (el.type === "relation") out.set(el.id, el.members || []);
      }
    } catch (err) {
      console.log(`  child chunk failed: ${String(err).slice(0, 60)}`);
    }
    await sleep(1200);
  }
  return out;
}

/** A relation's own way members, plus the ways of any child relations. */
function effectiveMembers(rel: OSMRelation, children: Map<number, OSMMember[]>): OSMMember[] {
  const members = rel.members || [];
  if (!members.some((m) => m.type === "relation")) return members;

  const out: OSMMember[] = [];
  for (const m of members) {
    if (m.type === "way") out.push(m);
    else if (m.type === "relation" && typeof m.ref === "number") {
      for (const cm of children.get(m.ref) || []) {
        if (cm.type === "way") out.push(cm);
      }
    }
  }
  return out;
}

function buildRoute(rel: OSMRelation, countryName: string, children: Map<number, OSMMember[]>) {
  const lines: number[][][] = [];
  let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180;
  let distance = 0;

  for (const member of effectiveMembers(rel, children)) {
    if (member.type !== "way" || !member.geometry || member.geometry.length < 2) continue;
    const coords: number[][] = [];
    let prev: { lat: number; lon: number } | null = null;
    for (const pt of member.geometry) {
      coords.push([pt.lon, pt.lat]);
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lon < minLng) minLng = pt.lon;
      if (pt.lon > maxLng) maxLng = pt.lon;
      if (prev) distance += haversine(prev, pt);
      prev = pt;
    }
    lines.push(coords);
  }

  if (lines.length === 0) return null;

  const geometry =
    lines.length === 1
      ? { type: "LineString" as const, coordinates: lines[0] }
      : { type: "MultiLineString" as const, coordinates: lines };

  const tags = rel.tags || {};
  const distanceKm = tags.distance ? parseFloat(tags.distance) : Math.round(distance * 10) / 10;
  const ascentM = tags.ascent ? parseFloat(tags.ascent) : null;

  // Route type: Loop if start & end are close, else Out & Back
  const start = lines[0][0];
  const lastLine = lines[lines.length - 1];
  const end = lastLine[lastLine.length - 1];
  const endGap = haversine(
    { lat: start[1], lon: start[0] },
    { lat: end[1], lon: end[0] }
  );
  const routeType = endGap < 0.5 ? "Loop" : "Out & Back";

  // Naismith's rule: ~12 min/km + 10 min per 100m of ascent
  const estTimeMin = Math.round(distanceKm * 12 + (ascentM || 0) / 100 * 10);

  return {
    osm_id: rel.id,
    name: tags.name || tags["name:en"] || tags.ref || null,
    network: tags.network || null,
    distance_km: distanceKm,
    difficulty: sacToDifficulty(tags.sac_scale),
    ascent_m: ascentM,
    descent_m: tags.descent ? parseFloat(tags.descent) : null,
    route_type: routeType,
    est_time_min: estTimeMin || null,
    geometry,
    // `path` (PostGIS geography) is computed in the DB by a trigger from `geometry`
    bbox_min_lat: minLat,
    bbox_min_lng: minLng,
    bbox_max_lat: maxLat,
    bbox_max_lng: maxLng,
    country: countryName,
    region: tags["addr:state"] || tags.region || null,
    description: tags.description || null,
    tags,
  };
}

type RouteRow = NonNullable<ReturnType<typeof buildRoute>>;

/**
 * Upsert routes with adaptive batch sizing. Route geometry is heavy and a
 * PostGIS trigger recomputes `path` per row, so a large batch blows the
 * statement timeout. On timeout we halve the batch and retry rather than
 * dropping the rows on the floor.
 */
async function upsertRows(rows: RouteRow[]): Promise<number> {
  let saved = 0;
  let batchSize = 25;
  let i = 0;

  while (i < rows.length) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from("routes").upsert(batch, { onConflict: "osm_id" });

    if (!error) {
      saved += batch.length;
      i += batchSize;
      process.stdout.write(`\r  Upserted ${Math.min(i, rows.length)}/${rows.length} (batch ${batchSize})   `);
      continue;
    }

    const isTimeout = /timeout|canceling statement/i.test(error.message);
    if (isTimeout && batchSize > 1) {
      batchSize = Math.max(1, Math.floor(batchSize / 2));
      console.log(`\n  timeout — reducing batch to ${batchSize}`);
      await sleep(1000);
      continue;
    }

    // Single row that still fails: log and skip so one bad geometry can't
    // stall the whole country.
    console.error(`\n  Skipping ${batch.length} row(s): ${error.message.slice(0, 90)}`);
    i += batchSize;
    await sleep(500);
  }
  return saved;
}

async function main() {
  // `--all` flag anywhere in the args = import every hiking route.
  // Default = significant routes only (international/national/regional networks).
  const args = process.argv.slice(2);
  if (args.includes("--all")) SIGNIFICANT_ONLY = false;
  const countryArg = (args.find((a) => !a.startsWith("--")) || "GR").toUpperCase();
  const countries = countryArg.split(",").map((c) => c.trim());

  console.log(`\n🥾 All Mountains — Route Import`);
  console.log(`   Mode: ${SIGNIFICANT_ONLY ? "significant routes only (iwn/nwn/rwn)" : "ALL hiking routes"}`);
  console.log(`   Countries: ${countries.join(", ")}\n`);

  let total = 0;
  for (const cc of countries) {
    const countryName = getCountryName(cc);
    console.log(`${countryName} (${cc})`);
    const relations = await fetchRoutes(cc);
    console.log(`  Found ${relations.length} hiking routes`);

    const children = await resolveChildRelations(relations);
    const rows = relations
      .map((r) => buildRoute(r, countryName, children))
      .filter((r): r is NonNullable<typeof r> => r !== null && !!r.name);

    console.log(`  ${rows.length} named routes with geometry`);

    total += await upsertRows(rows);
    console.log();
  }

  console.log(`\n  Linking routes to nearby peaks (this may take a moment)...`);
  const { error: linkErr } = await supabase.rpc("link_route_peaks", { buffer_m: 500 });
  if (linkErr) console.error(`  Link error: ${linkErr.message}`);
  else console.log(`  ✓ Routes linked to peaks`);

  console.log(`\n✅ Route import complete! ${total} routes.`);
}

main().catch(console.error);

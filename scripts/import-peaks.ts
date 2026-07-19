/**
 * Mountain Peaks Import Script
 *
 * Fetches all mountain peaks from OpenStreetMap via the Overpass API
 * and inserts them into the Supabase peaks table.
 *
 * Usage: npx tsx scripts/import-peaks.ts [country-code]
 * Examples:
 *   npx tsx scripts/import-peaks.ts GR          # Greece only
 *   npx tsx scripts/import-peaks.ts ALL         # All countries
 *   npx tsx scripts/import-peaks.ts "GR,IT,CH"  # Multiple countries
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Multiple Overpass mirrors — we rotate through them on timeout/failure.
// The main instance is often overloaded (504), the mirrors are usually faster.
const OVERPASS_MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ISO 3166-1 country codes — import all or specific ones
const ALL_COUNTRIES = [
  // North America
  "JP"
];

interface OSMElement {
  type: string;
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

// Large, peak-dense countries whose single-query Overpass request times out.
// [minLat, minLng, maxLat, maxLng] — these get tiled instead.
const COUNTRY_BBOX: Record<string, [number, number, number, number]> = {
  US: [24.5, -125, 49.5, -66.9], CA: [41.7, -141, 70, -52.6], MX: [14.5, -118.4, 32.7, -86.7],
  RU: [41.2, 19.6, 81.9, 180], CN: [18.2, 73.5, 53.6, 134.8], JP: [24.0, 122.9, 45.6, 145.8],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Run one Overpass query, rotating mirrors on failure.
async function overpassPeaks(query: string): Promise<OSMElement[]> {
  let lastError = "";
  for (const url of OVERPASS_MIRRORS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "AllMountains/1.0 (peak import; contact aidendrepaniotis@gmail.com)",
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) {
        lastError = `${response.status} from ${new URL(url).hostname}`;
        await sleep(2000);
        continue;
      }
      const data = await response.json();
      return data.elements || [];
    } catch (err) {
      lastError = `${err}`;
      await sleep(2000);
    }
  }
  throw new Error(`All mirrors failed: ${lastError}`);
}

// Fetch peaks in a bbox tile, recursively splitting on timeout/failure.
async function fetchPeakTile(
  cc: string, s: number, w: number, n: number, e: number, depth: number
): Promise<OSMElement[]> {
  const query =
    `[out:json][timeout:180];area["ISO3166-1"="${cc}"]->.a;` +
    `node["natural"="peak"](area.a)(${s},${w},${n},${e});out body;`;
  const pad = "  ".repeat(depth + 1);
  try {
    const els = await overpassPeaks(query);
    console.log(`${pad}[${s.toFixed(1)},${w.toFixed(1)} → ${n.toFixed(1)},${e.toFixed(1)}] ${els.length} peaks`);
    return els;
  } catch (err) {
    if (depth < 4) {
      console.log(`${pad}tile failed — splitting into 4...`);
      const midLat = (s + n) / 2, midLng = (w + e) / 2;
      const quads: [number, number, number, number][] = [
        [s, w, midLat, midLng], [s, midLng, midLat, e],
        [midLat, w, n, midLng], [midLat, midLng, n, e],
      ];
      let all: OSMElement[] = [];
      for (const [qs, qw, qn, qe] of quads) {
        all = all.concat(await fetchPeakTile(cc, qs, qw, qn, qe, depth + 1));
        await sleep(1200);
      }
      return all;
    }
    console.log(`${pad}giving up on tile: ${String(err).slice(0, 60)}`);
    return [];
  }
}

async function fetchPeaksForCountry(countryCode: string): Promise<OSMElement[]> {
  const bbox = COUNTRY_BBOX[countryCode];

  // Small country — one query is fine
  if (!bbox) {
    console.log(`  Querying overpass for ${countryCode}...`);
    return overpassPeaks(
      `[out:json][timeout:600];area["ISO3166-1"="${countryCode}"]->.a;` +
      `node["natural"="peak"](area.a);out body;`
    );
  }

  // Large country — tile it
  console.log(`  Tiling ${countryCode} (large country)...`);
  const [minLat, minLng, maxLat, maxLng] = bbox;
  const els = await fetchPeakTile(countryCode, minLat, minLng, maxLat, maxLng, 0);

  // Dedup nodes that appeared in overlapping tiles
  const map = new Map<number, OSMElement>();
  for (const el of els) if (el.type === "node") map.set(el.id, el);
  return Array.from(map.values());
}

function getDifficulty(elevation: number | null): string {
  if (!elevation) return "Easy";
  if (elevation < 1000) return "Easy";
  if (elevation < 2000) return "Moderate";
  if (elevation < 3000) return "Hard";
  if (elevation < 4000) return "Expert";
  return "Extreme";
}

function getCountryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

async function insertPeaks(elements: OSMElement[], countryCode: string) {
  const countryName = getCountryName(countryCode);
  const batchSize = 500;
  let inserted = 0;

  for (let i = 0; i < elements.length; i += batchSize) {
    const batch = elements.slice(i, i + batchSize);

    const rows = batch.map((el) => {
      const elevation = el.tags?.ele ? parseFloat(el.tags.ele) : null;
      const wikiTag = el.tags?.wikipedia;
      const wikipediaUrl = wikiTag
        ? `https://en.wikipedia.org/wiki/${wikiTag.replace(/^[a-z]+:/, "").replace(/ /g, "_")}`
        : null;

      return {
        osm_id: el.id,
        name: el.tags?.name || el.tags?.["name:en"] || null,
        name_en: el.tags?.["name:en"] || null,
        elevation,
        prominence: el.tags?.prominence ? parseFloat(el.tags.prominence) : null,
        latitude: el.lat,
        longitude: el.lon,
        location: `SRID=4326;POINT(${el.lon} ${el.lat})`,
        country: countryName,
        region: el.tags?.["is_in:state"] || el.tags?.["is_in"] || null,
        wikipedia_url: wikipediaUrl,
        difficulty: getDifficulty(elevation),
        // `tags` column intentionally omitted — dropped to save DB space
        // (the multilingual OSM tag blob is unused in the app).
      };
    });

    const { error } = await supabase
      .from("peaks")
      .upsert(rows, { onConflict: "osm_id", ignoreDuplicates: false });

    if (error) {
      console.error(`  Error inserting batch: ${error.message}`);
    } else {
      inserted += batch.length;
      process.stdout.write(
        `\r  Inserted ${inserted}/${elements.length} peaks for ${countryCode}`
      );
    }
  }

  console.log(); // newline after progress
  return inserted;
}

async function main() {
  const arg = process.argv[2] || "GR";
  let countries: string[];

  if (arg === "ALL") {
    countries = ALL_COUNTRIES;
  } else {
    countries = arg.split(",").map((c) => c.trim().toUpperCase());
  }

  console.log(`\n🏔️  All Mountains — Peak Import`);
  console.log(`   Countries: ${countries.length}`);
  console.log(`   Target: ${SUPABASE_URL}\n`);

  let totalInserted = 0;
  let totalErrors = 0;

  for (let i = 0; i < countries.length; i++) {
    const cc = countries[i];
    console.log(
      `[${i + 1}/${countries.length}] ${getCountryName(cc)} (${cc})`
    );

    try {
      const elements = await fetchPeaksForCountry(cc);
      console.log(`  Found ${elements.length} peaks`);

      if (elements.length > 0) {
        const count = await insertPeaks(elements, cc);
        totalInserted += count;
      }

      // Rate limit: wait between countries to be nice to Overpass
      if (i < countries.length - 1) {
        console.log(`  Waiting 5s before next country...`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    } catch (err) {
      console.error(`  ERROR: ${err}`);
      totalErrors++;
      // Wait longer after an error (Overpass might be throttling)
      await new Promise((r) => setTimeout(r, 15000));
    }
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   Total peaks inserted: ${totalInserted.toLocaleString()}`);
  console.log(`   Errors: ${totalErrors}`);
}

main().catch(console.error);

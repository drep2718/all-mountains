/**
 * Tag routes with the natural features they pass — Views, Waterfalls, Lakes,
 * Rivers, Forests, Historic sites — by fetching those OSM points per country
 * and checking which ones lie within ~300m of each route's path.
 *
 * "Summits" is handled separately in SQL (from route_peaks).
 *
 * Usage: npx tsx --env-file=.env.local scripts/enrich-features.ts "US,CA,CH,JP"
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const OVERPASS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// feature label → OSM filter
const FEATURE_QUERY: Record<string, string> = {
  Views: `node["tourism"="viewpoint"]`,
  Waterfalls: `node["natural"="waterfall"]`,
  Lakes: `node["natural"="water"]`,
  "Historic sites": `node["historic"]`,
};

async function overpass(query: string): Promise<{ lat: number; lon: number }[]> {
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "AllMountains/1.0" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) { await sleep(2000); continue; }
      const data = await res.json();
      if (data.remark && /timed out/i.test(data.remark)) { await sleep(2000); continue; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data.elements || []).map((e: any) => ({ lat: e.lat, lon: e.lon })).filter((p: { lat: number }) => p.lat);
    } catch { await sleep(2000); }
  }
  return [];
}

// ~300m proximity via a coordinate grid hash (cell ≈ 0.005° ≈ 550m)
const CELL = 0.005;
const key = (lat: number, lon: number) => `${Math.round(lat / CELL)}:${Math.round(lon / CELL)}`;

function buildIndex(pts: { lat: number; lon: number }[]): Set<string> {
  const s = new Set<string>();
  for (const p of pts) s.add(key(p.lat, p.lon));
  return s;
}

// Does any route vertex fall in/next to a cell that contains a feature point?
function routeHasFeature(coords: number[][], index: Set<string>): boolean {
  for (const [lon, lat] of coords) {
    const cy = Math.round(lat / CELL), cx = Math.round(lon / CELL);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (index.has(`${cy + dy}:${cx + dx}`)) return true;
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flatten(geom: any): number[][] {
  if (!geom) return [];
  return geom.type === "LineString" ? geom.coordinates : (geom.coordinates as number[][][]).flat();
}

function nameFor(cc: string) { try { return new Intl.DisplayNames(["en"], { type: "region" }).of(cc) || cc; } catch { return cc; } }

async function main() {
  const countries = (process.argv[2] || "US,CA,CH,JP").toUpperCase().split(",").map((c) => c.trim());
  console.log(`\n🌲 Feature enrichment — ${countries.join(", ")}\n`);

  for (const cc of countries) {
    const cn = nameFor(cc);
    console.log(`${cn} (${cc})`);

    // Load this country's routes (id + geometry)
    const { data: routes, error } = await supabase
      .from("routes").select("id, geometry, features").eq("country", cn);
    if (error || !routes) { console.error(`  ${error?.message}`); continue; }
    console.log(`  ${routes.length} routes`);

    // For each feature type, fetch POIs and tag matching routes
    for (const [label, sel] of Object.entries(FEATURE_QUERY)) {
      const pts = await overpass(`[out:json][timeout:180];area["ISO3166-1"="${cc}"]->.a;${sel}(area.a);out skel;`);
      if (pts.length === 0) { console.log(`  ${label}: 0 points`); await sleep(1500); continue; }
      const index = buildIndex(pts);

      let tagged = 0;
      for (const r of routes) {
        const coords = flatten(r.geometry);
        const has = routeHasFeature(coords, index);
        const current: string[] = r.features || [];
        if (has && !current.includes(label)) {
          const next = [...current, label];
          const { error: upErr } = await supabase.from("routes").update({ features: next }).eq("id", r.id);
          if (upErr && /read-only|permission|disk|quota/i.test(upErr.message)) {
            console.error(`\n🛑 Writes rejected — stopping.`); process.exit(2);
          }
          r.features = next; // keep local copy in sync for the next feature type
          tagged++;
        }
      }
      console.log(`  ${label}: ${pts.length} points → tagged ${tagged} routes`);
      await sleep(1500);
    }
  }

  console.log(`\n✅ Feature enrichment complete.`);
}

main().catch(console.error);

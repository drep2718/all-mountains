/**
 * Audit the trails table: duplicates, junk, geometry validity, coverage.
 * Read-only. Usage: npx tsx --env-file=.env.local scripts/audit-data.ts
 */

import { createClient } from "@supabase/supabase-js";
import { decodeSegments } from "../src/lib/polyline";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Row {
  id: number; osm_id: number; name: string | null; country: string | null;
  distance_km: number | null; network: string | null; poly: string | null;
  bbox_min_lat: number; bbox_min_lng: number; bbox_max_lat: number; bbox_max_lng: number;
}

// Names that are plainly roads rather than trails: "229th Street", "310 Avenue",
// numbered county/township roads. These come from highway=track in farm country.
const ROADLIKE =
  /^\d+(st|nd|rd|th)?\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|place|pl)\b/i;
const ROADLIKE2 = /^(county|township|forest service|fs)\s+(road|rd|route)\b/i;

async function fetchAll(): Promise<Row[]> {
  const cols = "id,osm_id,name,country,distance_km,network,poly,bbox_min_lat,bbox_min_lng,bbox_max_lat,bbox_max_lng";
  const out: Row[] = [];
  let after = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("routes").select(cols).gt("id", after).order("id", { ascending: true }).limit(1000);
    if (error) { console.error(error.message); break; }
    const rows = (data ?? []) as unknown as Row[];
    if (!rows.length) break;
    out.push(...rows);
    after = rows[rows.length - 1].id;
    process.stdout.write(`\r  fetched ${out.length}`);
  }
  console.log();
  return out;
}

const pct = (n: number, total: number) => `${((n / total) * 100).toFixed(1)}%`;

async function main() {
  console.log("\nFetching every trail…");
  const rows = await fetchAll();
  const n = rows.length;
  if (!n) { console.log("no rows"); return; }

  // --- duplicates ----------------------------------------------------------
  const byOsm = new Map<number, number>();
  for (const r of rows) byOsm.set(r.osm_id, (byOsm.get(r.osm_id) ?? 0) + 1);
  const dupOsm = [...byOsm.values()].filter((c) => c > 1).length;

  // Same name AND essentially the same footprint = a real duplicate trail.
  const byNameBox = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${(r.name ?? "").toLowerCase()}|${r.bbox_min_lat.toFixed(3)},${r.bbox_min_lng.toFixed(3)},${r.bbox_max_lat.toFixed(3)},${r.bbox_max_lng.toFixed(3)}`;
    (byNameBox.get(key) ?? byNameBox.set(key, []).get(key)!).push(r);
  }
  const dupGroups = [...byNameBox.values()].filter((g) => g.length > 1);
  const dupRows = dupGroups.reduce((s, g) => s + (g.length - 1), 0);

  // Same name anywhere — usually legitimate ("Ridge Trail" exists in many places).
  const byName = new Map<string, number>();
  for (const r of rows) {
    const k = (r.name ?? "").toLowerCase();
    byName.set(k, (byName.get(k) ?? 0) + 1);
  }
  const sharedNames = [...byName.values()].filter((c) => c > 1).length;

  // --- geometry ------------------------------------------------------------
  let badGeom = 0, singlePoint = 0, totalPts = 0;
  for (const r of rows) {
    const lines = decodeSegments(r.poly);
    const pts = lines.reduce((s, l) => s + l.length, 0);
    totalPts += pts;
    if (!lines.length || pts === 0) badGeom++;
    else if (pts < 2) singlePoint++;
  }

  // --- junk ----------------------------------------------------------------
  const roadlike = rows.filter((r) => r.name && (ROADLIKE.test(r.name) || ROADLIKE2.test(r.name)));

  // --- country correctness -------------------------------------------------
  // Canada's land border with the US is the 49th parallel in the west and no
  // lower than ~41.7 anywhere. Anything labelled Canada well south of 45 is
  // certainly mislabelled.
  const caTooSouth = rows.filter((r) => r.country === "Canada" && r.bbox_max_lat < 45);
  const usTooNorth = rows.filter((r) => r.country === "United States" && r.bbox_min_lat > 50);

  console.log(`\n=== TOTALS ===`);
  console.log(`  rows                 ${n}`);
  console.log(`  relations            ${rows.filter((r) => r.osm_id > 0).length}`);
  console.log(`  ways                 ${rows.filter((r) => r.osm_id < 0).length}`);

  console.log(`\n=== DUPLICATES ===`);
  console.log(`  duplicate osm_id     ${dupOsm}  ${dupOsm === 0 ? "(unique constraint holding)" : "← PROBLEM"}`);
  console.log(`  same name + footprint ${dupRows} rows in ${dupGroups.length} groups  ${pct(dupRows, n)}`);
  console.log(`  names shared by 2+   ${sharedNames}  (usually legitimate)`);
  if (dupGroups.length) {
    console.log(`  examples:`);
    for (const g of dupGroups.slice(0, 5)) {
      console.log(`    "${g[0].name}" x${g.length}  osm_ids: ${g.map((r) => r.osm_id).join(", ")}`);
    }
  }

  console.log(`\n=== GEOMETRY ===`);
  console.log(`  undecodable          ${badGeom}  ${pct(badGeom, n)}`);
  console.log(`  fewer than 2 points  ${singlePoint}`);
  console.log(`  avg points/trail     ${(totalPts / n).toFixed(0)}`);

  console.log(`\n=== DATA QUALITY ===`);
  console.log(`  road-like names      ${roadlike.length}  ${pct(roadlike.length, n)}  ← farm/section roads, not trails`);
  roadlike.slice(0, 5).forEach((r) => console.log(`    "${r.name}" (${r.country})`));

  console.log(`\n=== COUNTRY LABELS ===`);
  console.log(`  "Canada" below 45°N  ${caTooSouth.length}  ${pct(caTooSouth.length, n)}  ← mislabelled, actually US`);
  console.log(`  "US" above 50°N      ${usTooNorth.length}`);
  const byCountry = new Map<string, number>();
  for (const r of rows) byCountry.set(r.country ?? "null", (byCountry.get(r.country ?? "null") ?? 0) + 1);
  [...byCountry.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`    ${k.padEnd(16)} ${v}`));

  console.log(`\n=== VERDICT ===`);
  const junk = new Set([...roadlike, ...caTooSouth].map((r) => r.id)).size;
  console.log(`  clean trails         ${n - junk - dupRows}`);
  console.log(`  suspect rows         ${junk + dupRows}  ${pct(junk + dupRows, n)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

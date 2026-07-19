/**
 * Finish Import — one script to fetch the remaining peaks + significant routes
 * for the countries you're keeping, with a hard write-rejection guard.
 *
 * It PROBES that the database accepts writes before doing anything, and ABORTS
 * loudly the moment any insert is rejected (read-only mode / over the storage
 * limit) — so it can never silently "finish" having written nothing.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/finish-import.ts            # US,CA,CH,JP
 *   npx tsx --env-file=.env.local scripts/finish-import.ts "US,CH"    # custom list
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

// Large / peak-dense countries get tiled so Overpass doesn't time out.
const COUNTRY_BBOX: Record<string, [number, number, number, number]> = {
  US: [24.5, -125, 49.5, -66.9], CA: [41.7, -141, 70, -52.6], MX: [14.5, -118.4, 32.7, -86.7],
  FR: [41.3, -5.2, 51.1, 9.6], IT: [36.6, 6.6, 47.1, 18.5], CH: [45.8, 5.9, 47.8, 10.5],
  JP: [24.0, 122.9, 45.6, 145.8], DE: [47.3, 5.9, 55.1, 15.0], AT: [46.4, 9.5, 49.0, 17.2],
  ES: [36.0, -9.3, 43.8, 3.3], NO: [57.9, 4.6, 71.2, 31.1],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const name = (cc: string) => { try { return new Intl.DisplayNames(["en"], { type: "region" }).of(cc) || cc; } catch { return cc; } };

// ─────────────────────────── write-rejection guard ───────────────────────────

class WriteRejected extends Error {}

function looksRejected(msg: string): boolean {
  const m = msg.toLowerCase();
  return [
    "read-only", "read only", "readonly", "disk", "quota", "storage",
    "permission denied", "exceeded", "no space", "out of", "too large for",
    "cannot execute", "25006", "53100", "53400",
  ].some((s) => m.includes(s));
}

function abortWrites(reason: string): never {
  console.error("\n" + "═".repeat(64));
  console.error("🛑  WRITES ARE BEING REJECTED — STOPPING IMMEDIATELY");
  console.error("═".repeat(64));
  console.error(`Reason: ${reason}`);
  console.error(
    "\nYour database is refusing inserts — almost certainly read-only\n" +
    "because it is at/over the 500 MB free-tier limit.\n\n" +
    "What to do:\n" +
    "  1. Open the Supabase SQL Editor and free space, e.g.:\n" +
    "       DELETE FROM peaks WHERE country NOT IN ('United States','Canada','Switzerland','Japan');\n" +
    "       TRUNCATE routes, route_peaks;\n" +
    "       VACUUM FULL peaks;\n" +
    "  2. Check size:  SELECT pg_size_pretty(pg_database_size(current_database()));\n" +
    "  3. Re-run this script once you're comfortably under 500 MB.\n"
  );
  process.exit(2);
}

// Upsert a batch; abort the whole run if the DB rejects the write.
async function guardedUpsert(table: string, rows: object[], conflict: string) {
  const { error } = await supabase.from(table).upsert(rows, { onConflict: conflict });
  if (error) {
    if (looksRejected(error.message)) abortWrites(`${table}: ${error.message}`);
    // Non-rejection error (transient) — retry once
    await sleep(2000);
    const retry = await supabase.from(table).upsert(rows, { onConflict: conflict });
    if (retry.error) {
      if (looksRejected(retry.error.message)) abortWrites(`${table}: ${retry.error.message}`);
      throw new Error(`${table} upsert failed: ${retry.error.message}`);
    }
  }
}

// Confirm the DB accepts writes before doing any work.
async function probeWrites() {
  process.stdout.write("Probing that the database accepts writes... ");
  const probe = {
    osm_id: -999_999, name: "__write_probe__", latitude: 0, longitude: 0,
    location: "SRID=4326;POINT(0 0)", country: "__probe__", difficulty: "Easy",
  };
  const { error } = await supabase.from("peaks").upsert(probe, { onConflict: "osm_id" });
  if (error) {
    console.log("REJECTED");
    abortWrites(`write probe: ${error.message}`);
  }
  await supabase.from("peaks").delete().eq("osm_id", -999_999);
  console.log("OK ✓\n");
}

// ─────────────────────────────── overpass ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function overpass(query: string): Promise<any[]> {
  let last = "";
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "AllMountains/1.0 (finish import; contact aidendrepaniotis@gmail.com)",
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) { last = `${res.status}`; await sleep(2000); continue; }
      const data = await res.json();
      // Overpass returns HTTP 200 with an empty result + a `remark` when a query
      // times out server-side. Treat that as a failure so the tile subdivides.
      if (data.remark && /timed out|runtime error|out of memory/i.test(data.remark)) {
        throw new Error("OVERPASS_TIMEOUT");
      }
      return data.elements || [];
    } catch (err) {
      if (String(err).includes("Cannot create a string longer")) throw new Error("TOO_LARGE");
      last = String(err); await sleep(2000);
    }
  }
  throw new Error(`all mirrors failed: ${last}`);
}

// Generic recursive bbox-tiling fetch for peaks or routes.
async function tiledFetch(
  cc: string, selector: string, out: string,
  s: number, w: number, n: number, e: number, depth: number
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const q = `[out:json][timeout:180];area["ISO3166-1"="${cc}"]->.a;${selector}(area.a)(${s},${w},${n},${e});${out};`;
  const pad = "  ".repeat(depth + 1);
  try {
    const els = await overpass(q);
    // Only print tiles that actually found something (skip the ocean spam)
    if (els.length > 0) console.log(`${pad}[${s.toFixed(1)},${w.toFixed(1)}→${n.toFixed(1)},${e.toFixed(1)}] ${els.length}`);
    return els;
  } catch {
    if (depth < 4) {
      console.log(`${pad}splitting tile...`);
      const mLat = (s + n) / 2, mLng = (w + e) / 2;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let all: any[] = [];
      for (const [a, b, c, d] of [[s, w, mLat, mLng], [s, mLng, mLat, e], [mLat, w, n, mLng], [mLat, mLng, n, e]] as const) {
        all = all.concat(await tiledFetch(cc, selector, out, a, b, c, d, depth + 1));
        await sleep(1000);
      }
      return all;
    }
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(cc: string, selector: string, out: string): Promise<any[]> {
  const bbox = COUNTRY_BBOX[cc];

  // Try the whole country in ONE query first. For significant-only routes and
  // for smaller countries this returns fine — no need to tile. We only fall
  // back to a grid if it's too large / times out (mainly the US, with its
  // giant thru-trails, and dense US peaks).
  try {
    const els = await overpass(`[out:json][timeout:300];area["ISO3166-1"="${cc}"]->.a;${selector}(area.a);${out};`);
    console.log(`  whole country in one query: ${els.length}`);
    const m = new Map<number, object>();
    for (const el of els) m.set(el.id, el);
    return Array.from(m.values());
  } catch {
    if (!bbox) return [];
    console.log(`  too big for one query — tiling ${cc} on a grid...`);
  }

  const [s, w, n, e] = bbox;
  const STEP = 4; // degrees
  const map = new Map<number, object>();
  for (let lat = s; lat < n; lat += STEP) {
    for (let lng = w; lng < e; lng += STEP) {
      const els = await tiledFetch(cc, selector, out, lat, lng, Math.min(lat + STEP, n), Math.min(lng + STEP, e), 0);
      for (const el of els) map.set(el.id, el);
      await sleep(700);
    }
  }
  return Array.from(map.values());
}

// ─────────────────────────────── builders ────────────────────────────────────

function difficultyFromEle(el: number | null): string {
  if (!el) return "Easy";
  if (el < 1000) return "Easy"; if (el < 2000) return "Moderate";
  if (el < 3000) return "Hard"; if (el < 4000) return "Expert"; return "Extreme";
}
function sacToDiff(sac?: string): string {
  return { hiking: "Easy", mountain_hiking: "Moderate", demanding_mountain_hiking: "Hard",
    alpine_hiking: "Expert", demanding_alpine_hiking: "Extreme", difficult_alpine_hiking: "Extreme" }[sac || ""] || "Moderate";
}
function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Downsample a route's geometry to at most `cap` total points. Giant thru-trails
// (Appalachian Trail etc.) have tens of thousands of points we don't need for
// display/thumbnails — this keeps upserts fast and the DB small.
function simplifyLines(lines: number[][][], cap = 1200): number[][][] {
  const total = lines.reduce((s, l) => s + l.length, 0);
  if (total <= cap) return lines;
  const stride = Math.ceil(total / cap);
  return lines.map((line) => {
    if (line.length <= 3) return line;
    const out = line.filter((_, i) => i % stride === 0);
    const lastPt = line[line.length - 1];
    if (out[out.length - 1] !== lastPt) out.push(lastPt);
    return out;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRoute(rel: any, countryName: string) {
  const lines: number[][][] = [];
  let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180, dist = 0;
  for (const m of rel.members || []) {
    if (m.type !== "way" || !m.geometry || m.geometry.length < 2) continue;
    const coords: number[][] = []; let prev = null;
    for (const p of m.geometry) {
      coords.push([p.lon, p.lat]);
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lon); maxLng = Math.max(maxLng, p.lon);
      if (prev) dist += haversine(prev, p); prev = p;
    }
    lines.push(coords);
  }
  if (!lines.length) return null;
  // Distance was computed above from the full-resolution geometry; now shrink
  // the stored geometry so huge trails don't blow up the DB or upsert time.
  const simple = simplifyLines(lines);
  const geometry = simple.length === 1
    ? { type: "LineString" as const, coordinates: simple[0] }
    : { type: "MultiLineString" as const, coordinates: simple };
  const t = rel.tags || {};
  const distKm = t.distance ? parseFloat(t.distance) : Math.round(dist * 10) / 10;
  const ascent = t.ascent ? parseFloat(t.ascent) : null;
  const start = lines[0][0], last = lines[lines.length - 1], end = last[last.length - 1];
  const loop = haversine({ lat: start[1], lon: start[0] }, { lat: end[1], lon: end[0] }) < 0.5;
  if (!(t.name || t["name:en"] || t.ref)) return null;
  return {
    osm_id: rel.id, name: t.name || t["name:en"] || t.ref || null, network: t.network || null,
    distance_km: distKm, difficulty: sacToDiff(t.sac_scale), ascent_m: ascent,
    descent_m: t.descent ? parseFloat(t.descent) : null,
    route_type: loop ? "Loop" : "Out & Back",
    est_time_min: Math.round(distKm * 12 + (ascent || 0) / 100 * 10) || null,
    geometry, bbox_min_lat: minLat, bbox_min_lng: minLng, bbox_max_lat: maxLat, bbox_max_lng: maxLng,
    country: countryName, region: t["addr:state"] || null, description: t.description || null, tags: t,
  };
}

// ─────────────────────────────────── main ────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const routesOnly = args.includes("--routes-only");
  const peaksOnly = args.includes("--peaks-only");
  const arg = (args.find((a) => !a.startsWith("--")) || "US,CA,CH,JP").toUpperCase();
  const countries = arg.split(",").map((c) => c.trim());

  console.log("\n🏔️  Finish Import — peaks + significant routes");
  console.log(`   Countries: ${countries.join(", ")}`);
  console.log(`   Phase: ${routesOnly ? "routes only" : peaksOnly ? "peaks only" : "peaks + routes"}\n`);

  await probeWrites();

  // ── PEAKS ──
  let peakTotal = 0;
  if (!routesOnly) {
  console.log("── Peaks ──");
  for (const cc of countries) {
    console.log(`${name(cc)} (${cc})`);
    const els = await fetchAll(cc, `node["natural"="peak"]`, "out body");
    console.log(`  fetched ${els.length} peaks`);
    const cn = name(cc);
    for (let i = 0; i < els.length; i += 500) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = els.slice(i, i + 500).map((el: any) => {
        const ele = el.tags?.ele ? parseFloat(el.tags.ele) : null;
        const wiki = el.tags?.wikipedia;
        return {
          osm_id: el.id, name: el.tags?.name || el.tags?.["name:en"] || null,
          name_en: el.tags?.["name:en"] || null, elevation: ele,
          prominence: el.tags?.prominence ? parseFloat(el.tags.prominence) : null,
          latitude: el.lat, longitude: el.lon, location: `SRID=4326;POINT(${el.lon} ${el.lat})`,
          country: cn, region: el.tags?.["is_in:state"] || null,
          wikipedia_url: wiki ? `https://en.wikipedia.org/wiki/${wiki.replace(/^[a-z]+:/, "").replace(/ /g, "_")}` : null,
          difficulty: difficultyFromEle(ele),
        };
      });
      await guardedUpsert("peaks", rows, "osm_id");
      peakTotal += rows.length;
      process.stdout.write(`\r  upserted ${Math.min(i + 500, els.length)}/${els.length}`);
    }
    console.log();
  }
  } // end peaks phase

  // ── ROUTES (significant only: iwn/nwn/rwn) ──
  let routeTotal = 0;
  if (!peaksOnly) {
  console.log("\n── Routes (significant: international/national/regional) ──");
  for (const cc of countries) {
    console.log(`${name(cc)} (${cc})`);
    const rels = await fetchAll(cc, `relation["route"="hiking"]["network"~"^(iwn|nwn|rwn)$"]`, "out geom");
    const rows = rels.map((r) => buildRoute(r, name(cc))).filter(Boolean) as object[];
    console.log(`  ${rows.length} named routes`);
    // Small batches — each route triggers a PostGIS geometry conversion, and the
    // Nano DB has a short statement timeout.
    for (let i = 0; i < rows.length; i += 25) {
      await guardedUpsert("routes", rows.slice(i, i + 25), "osm_id");
      routeTotal += Math.min(25, rows.length - i);
      process.stdout.write(`\r  upserted ${Math.min(i + 25, rows.length)}/${rows.length}`);
    }
    console.log();
  }
  } // end routes phase

  console.log(`\n✅ Done. Peaks upserted: ${peakTotal.toLocaleString()}, Routes: ${routeTotal.toLocaleString()}`);
  console.log("\nNext — link routes to peaks in the Supabase SQL Editor:");
  console.log("   SET statement_timeout = '1200s';");
  console.log("   SELECT link_route_peaks(500);\n");
}

main().catch((e) => { console.error("\nError:", e.message); process.exit(1); });

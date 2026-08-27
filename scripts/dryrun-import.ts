/**
 * Dry-run the lean importer against a saved Overpass response.
 *
 * Builds rows exactly as the importer would, then checks that the encoded
 * polyline decodes back to the trail, and reports the real per-row size. No
 * database needed — this is how the lean schema gets verified while Postgres
 * is down.
 *
 * Usage: npx tsx scripts/dryrun-import.ts /tmp/ov.json
 */

import { readFile } from "node:fs/promises";
import { toStored, decodeSegments, type LngLat } from "../src/lib/polyline";

interface Way {
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

function haversineM(a: LngLat, b: LngLat): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Perpendicular distance in metres from p to the segment a→b. */
function pointToSegmentM(p: LngLat, a: LngLat, b: LngLat): number {
  // Project to a local metre plane; segments are short enough for this to hold.
  const latRef = (p[1] * Math.PI) / 180;
  const mx = (deg: number) => deg * 111320 * Math.cos(latRef);
  const my = (deg: number) => deg * 110540;

  const px = mx(p[0]), py = my(p[1]);
  const ax = mx(a[0]), ay = my(a[1]);
  const bx = mx(b[0]), by = my(b[1]);

  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Largest distance from any original point to the simplified *line*.
 *
 * Must measure to the nearest segment, not the nearest surviving vertex:
 * simplification deliberately drops points that lie along a straight run, and
 * those points are far from any vertex while sitting exactly on the line.
 * Measuring to vertices reports a huge error for geometry that is in fact
 * faithful.
 */
function maxDeviationM(original: LngLat[], simplified: LngLat[]): number {
  if (simplified.length < 2) return Infinity;
  let worst = 0;
  for (const p of original) {
    let best = Infinity;
    for (let i = 1; i < simplified.length; i++) {
      const d = pointToSegmentM(p, simplified[i - 1], simplified[i]);
      if (d < best) best = d;
    }
    if (best > worst) worst = best;
  }
  return worst;
}

async function main() {
  const file = process.argv[2] || "/tmp/ov.json";
  const raw = JSON.parse(await readFile(file, "utf8"));
  const ways = ((raw.elements || []) as Way[]).filter(
    (w) => w.geometry && w.geometry.length >= 2
  );

  if (!ways.length) {
    console.error("No usable ways in " + file);
    process.exitCode = 1;
    return;
  }

  let oldBytes = 0;
  let newBytes = 0;
  let worstDeviation = 0;
  let decodeFailures = 0;
  let emptyPoly = 0;

  for (const w of ways) {
    const coords = w.geometry!.map((p) => [p.lon, p.lat] as LngLat);
    const tags = w.tags || {};

    // What the row costs under each scheme.
    oldBytes += Buffer.byteLength(
      JSON.stringify({ type: "LineString", coordinates: coords }) + JSON.stringify(tags)
    );

    const poly = toStored([coords]);
    newBytes += Buffer.byteLength(poly);
    if (!poly) emptyPoly++;

    // The round-trip must give back a usable trail.
    const back = decodeSegments(poly)[0];
    if (!back || back.length < 2) {
      decodeFailures++;
      continue;
    }
    worstDeviation = Math.max(worstDeviation, maxDeviationM(coords, back));
  }

  const n = ways.length;
  console.log(`\nDry run over ${n} real trails from ${file}\n`);
  console.log(`  decode failures        ${decodeFailures}`);
  console.log(`  empty polylines        ${emptyPoly}`);
  console.log(`  worst point deviation  ${worstDeviation.toFixed(1)} m`);
  console.log(`  bytes/row before       ${(oldBytes / n).toFixed(0)}`);
  console.log(`  bytes/row after        ${(newBytes / n).toFixed(0)}`);
  console.log(`  reduction              ${(100 - (newBytes / oldBytes) * 100).toFixed(1)}%`);
  console.log(
    `\n  projected at 139k rows ${((newBytes / n) * 139_000 / 1e6).toFixed(1)} MB ` +
    `(was ${((oldBytes / n) * 139_000 / 1e6).toFixed(1)} MB)\n`
  );

  const ok = decodeFailures === 0 && emptyPoly === 0 && worstDeviation < 25;
  console.log(ok ? "  ✓ PASS" : "  ✗ FAIL — geometry did not survive the round trip");
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

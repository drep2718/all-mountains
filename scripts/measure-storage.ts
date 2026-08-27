/**
 * Measure how much smaller trail geometry gets under different storage schemes.
 *
 * Pulls real hiking trails from Overpass (the same source the importer uses),
 * then compares what one row costs today against the alternatives. No database
 * needed — this is meant to be runnable while Postgres is down.
 *
 * Usage: npx tsx scripts/measure-storage.ts
 */

const OVERPASS = "https://overpass.kumi.systems/api/interpreter";

interface Way {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

// --- encodings ---------------------------------------------------------------

/** Google polyline encoding, precision 5 (~1 m). */
function encodePolyline(coords: [number, number][], precision = 5): string {
  const factor = Math.pow(10, precision);
  let out = "";
  let prevLat = 0;
  let prevLng = 0;

  const enc = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let s = "";
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };

  for (const [lng, lat] of coords) {
    const la = Math.round(lat * factor);
    const ln = Math.round(lng * factor);
    out += enc(la - prevLat) + enc(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

/**
 * Ramer–Douglas–Peucker simplification. Tolerance is in degrees; 1e-4 is
 * roughly 11 m, which is invisible on a trail rendered at hiking zooms.
 */
function simplify(coords: [number, number][], tol: number): [number, number][] {
  if (coords.length <= 2) return coords;

  const sqSegDist = (p: [number, number], a: [number, number], b: [number, number]) => {
    let [x, y] = a;
    let dx = b[0] - x;
    let dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x;
    dy = p[1] - y;
    return dx * dx + dy * dy;
  };

  const tolSq = tol * tol;
  const keep = new Array(coords.length).fill(false);
  keep[0] = keep[coords.length - 1] = true;

  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxSq = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(coords[i], coords[first], coords[last]);
      if (d > maxSq) { maxSq = d; index = i; }
    }
    if (maxSq > tolSq && index !== -1) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");
const fmt = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB`
  : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)} KB`
  : `${n} B`;

async function main() {
  // A busy, well-mapped hiking area — representative of what the import pulled.
  const query =
    `[out:json][timeout:120];` +
    `way["highway"~"^(path|footway|track|bridleway)$"]["name"]` +
    `(46.75,-121.9,46.95,-121.6);out geom;`;

  // Allow measuring from a saved Overpass response, so this works when the
  // public mirrors are busy (they frequently are).
  const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (fileArg) {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(fileArg, "utf8");
    report(JSON.parse(raw).elements || []);
    return;
  }

  console.log("Fetching a real sample of trails from Overpass…\n");
  const MIRRORS = [
    OVERPASS,
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];

  let data: { elements?: Way[] } | null = null;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass answers 406 to requests without a real User-Agent.
          "User-Agent": "AllMountains/1.0 (storage sizing; aidendrepaniotis@gmail.com)",
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      const text = await res.text();
      if (!res.ok || !text.trim().startsWith("{")) {
        console.log(`  ${new URL(url).hostname}: ${res.status}, trying next…`);
        continue;
      }
      data = JSON.parse(text);
      break;
    } catch {
      console.log(`  ${new URL(url).hostname}: failed, trying next…`);
    }
  }
  if (!data) {
    console.error("All Overpass mirrors failed. Try again shortly.");
    return;
  }
  report(data.elements || []);
}

function report(elements: Way[]) {
  const ways = elements.filter((w) => w.geometry && w.geometry.length >= 2);

  if (!ways.length) {
    console.error("No sample returned — try again in a moment.");
    return;
  }

  let points = 0;
  let geojson = 0;
  let poly5 = 0;
  let poly5simp = 0;
  let tagsBytes = 0;

  for (const w of ways) {
    const coords = w.geometry!.map((p) => [p.lon, p.lat] as [number, number]);
    points += coords.length;

    // What we store today: GeoJSON in a jsonb column.
    geojson += bytes(JSON.stringify({ type: "LineString", coordinates: coords }));

    // Alternative: an encoded polyline in a text column.
    poly5 += bytes(encodePolyline(coords));

    // Alternative: simplified first, then encoded (~11 m tolerance).
    poly5simp += bytes(encodePolyline(simplify(coords, 1e-4)));

    tagsBytes += bytes(JSON.stringify(w.tags || {}));
  }

  const n = ways.length;
  const TOTAL_ROWS = 139_000;
  const scale = TOTAL_ROWS / n;

  console.log(`Sample: ${n} named trails, ${points.toLocaleString()} coordinates`);
  console.log(`Average ${(points / n).toFixed(0)} points per trail\n`);

  const rows: [string, number, string][] = [
    ["geometry as GeoJSON jsonb (today)", geojson, ""],
    ["+ PostGIS path geography (derived)", geojson * 0.8, "≈, mirrors geometry"],
    ["tags jsonb", tagsBytes, ""],
    ["geometry as encoded polyline", poly5, ""],
    ["encoded polyline, simplified ~11 m", poly5simp, ""],
  ];

  console.log("Per-sample totals, and projected across ~139k trails:\n");
  for (const [label, b, note] of rows) {
    console.log(
      `  ${label.padEnd(38)} ${fmt(b).padStart(9)}  →  ${fmt(b * scale).padStart(9)}  ${note}`
    );
  }

  const todayTotal = geojson + geojson * 0.8 + tagsBytes;
  const leanTotal = poly5simp;
  console.log(
    `\n  TODAY   geometry + path + tags          →  ${fmt(todayTotal * scale)}`
  );
  console.log(
    `  LEAN    simplified polyline only        →  ${fmt(leanTotal * scale)}`
  );
  console.log(
    `  saving                                  →  ${(100 - (leanTotal / todayTotal) * 100).toFixed(1)}%\n`
  );
  console.log(`  Supabase Free database limit            →  500 MB`);
}


main().catch((e) => console.error(e));

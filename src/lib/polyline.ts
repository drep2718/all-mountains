// Encoded polylines — how trail geometry is stored.
//
// A trail used to be kept as GeoJSON in a jsonb column plus a derived PostGIS
// `path` geography. Measured over real OSM trails that is ~185 MB across the
// catalogue; the same geometry as a simplified encoded polyline is ~4 MB, which
// is what lets the whole dataset fit a 500 MB database.
//
// Google polyline format, precision 5 (~1 m). Decoding is a tight loop over a
// short string — microseconds — so this costs the UI nothing.

export type LngLat = [number, number]; // GeoJSON order: [lng, lat]

/** ~11 m. Below the width of a trail corridor at any hiking zoom. */
export const SIMPLIFY_TOLERANCE = 1e-4;

export function encodePolyline(coords: LngLat[], precision = 5): string {
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

export function decodePolyline(encoded: string, precision = 5): LngLat[] {
  if (!encoded) return [];
  const factor = Math.pow(10, precision);
  const out: LngLat[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;

  while (i < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < encoded.length);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < encoded.length);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    out.push([lng / factor, lat / factor]);
  }
  return out;
}

/**
 * A trail can be several disjoint segments (a MultiLineString). Segments are
 * joined with a separator that cannot appear in the encoding, so one text
 * column still round-trips multi-part geometry.
 */
export const SEGMENT_SEP = ";";

export function encodeSegments(lines: LngLat[][]): string {
  return lines.map((l) => encodePolyline(l)).join(SEGMENT_SEP);
}

export function decodeSegments(encoded: string | null | undefined): LngLat[][] {
  if (!encoded) return [];
  return encoded
    .split(SEGMENT_SEP)
    .map((part) => decodePolyline(part))
    .filter((l) => l.length > 0);
}

/**
 * Ramer–Douglas–Peucker. Drops points that sit within `tol` of the line their
 * neighbours already describe, which is most of them on a GPS-traced path.
 */
export function simplify(coords: LngLat[], tol = SIMPLIFY_TOLERANCE): LngLat[] {
  if (coords.length <= 2) return coords;

  const sqSegDist = (p: LngLat, a: LngLat, b: LngLat) => {
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
  const keep = new Array<boolean>(coords.length).fill(false);
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

/** GeoJSON in, storage string out. Used by the importers. */
export function toStored(lines: LngLat[][], tol = SIMPLIFY_TOLERANCE): string {
  return encodeSegments(lines.map((l) => simplify(l, tol)));
}

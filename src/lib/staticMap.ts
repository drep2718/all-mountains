// Builds a Mapbox Static Images URL with a route drawn on it.
// This gives every trail a real map thumbnail from its own geometry —
// no photo backfill or storage needed.

import type { Route } from "./types";

// Google polyline encoding (precision 5) — the compact format Mapbox's
// Static API accepts for path overlays.
function encodePolyline(coords: [number, number][]): string {
  let output = "";
  let prevLat = 0;
  let prevLng = 0;

  const encodeValue = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let chunk = "";
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    chunk += String.fromCharCode(v + 63);
    return chunk;
  };

  for (const [lng, lat] of coords) {
    const lat5 = Math.round(lat * 1e5);
    const lng5 = Math.round(lng * 1e5);
    output += encodeValue(lat5 - prevLat);
    output += encodeValue(lng5 - prevLng);
    prevLat = lat5;
    prevLng = lng5;
  }
  return output;
}

// Flatten a LineString / MultiLineString into a single coordinate list.
function flatten(geometry: Route["geometry"]): [number, number][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") {
    return geometry.coordinates as [number, number][];
  }
  // MultiLineString — concatenate segments
  return (geometry.coordinates as [number, number][][]).flat();
}

// Downsample so the encoded URL stays well under Mapbox's length limit.
function sample(coords: [number, number][], max = 90): [number, number][] {
  if (coords.length <= max) return coords;
  const step = coords.length / max;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) out.push(coords[Math.floor(i * step)]);
  out.push(coords[coords.length - 1]);
  return out;
}

export function routeStaticMapUrl(
  route: Pick<Route, "geometry">,
  width = 640,
  height = 360,
  color = "c95d27"
): string | null {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  const coords = sample(flatten(route.geometry));
  if (coords.length < 2) return null;

  const encoded = encodePolyline(coords);
  const path = `path-4+${color}-0.9(${encodeURIComponent(encoded)})`;

  return (
    `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/` +
    `${path}/auto/${width}x${height}@2x?padding=30&access_token=${token}`
  );
}

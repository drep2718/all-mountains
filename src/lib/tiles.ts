// Slippy-map tile math for offline map downloads.
// Standard Web Mercator (XYZ) scheme, same as Mapbox/OSM.

export interface Tile {
  z: number;
  x: number;
  y: number;
}

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** Longitude → tile X at zoom z. */
export function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}

/** Latitude → tile Y at zoom z (Web Mercator). */
export function latToTileY(lat: number, z: number): number {
  // Mercator is undefined at the poles; clamp to the standard cutoff.
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clamped * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
  );
}

const clampTile = (v: number, z: number) => Math.max(0, Math.min(Math.pow(2, z) - 1, v));

/** Every tile covering a bbox across an inclusive zoom range. */
export function tilesForBBox(bbox: BBox, minZoom: number, maxZoom: number): Tile[] {
  const out: Tile[] = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = clampTile(lngToTileX(bbox.minLng, z), z);
    const x1 = clampTile(lngToTileX(bbox.maxLng, z), z);
    // Y is inverted: max latitude yields the smaller Y.
    const y0 = clampTile(latToTileY(bbox.maxLat, z), z);
    const y1 = clampTile(latToTileY(bbox.minLat, z), z);
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        out.push({ z, x, y });
      }
    }
  }
  return out;
}

/** Grow a bbox by a margin in km so the download covers the trail's surroundings. */
export function padBBox(bbox: BBox, km: number): BBox {
  const dLat = km / 110.574;
  const midLat = (bbox.minLat + bbox.maxLat) / 2;
  const dLng = km / (111.32 * Math.max(0.01, Math.cos((midLat * Math.PI) / 180)));
  return {
    minLat: Math.max(-85, bbox.minLat - dLat),
    maxLat: Math.min(85, bbox.maxLat + dLat),
    minLng: Math.max(-180, bbox.minLng - dLng),
    maxLng: Math.min(180, bbox.maxLng + dLng),
  };
}

/** Rough download size. Mapbox raster tiles average ~25 KB at 512px. */
export const AVG_TILE_BYTES = 25 * 1024;

export function estimateBytes(tileCount: number): number {
  return tileCount * AVG_TILE_BYTES;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Mapbox raster tile URL for a style. Raster (not vector) keeps offline
 * rendering simple: the tile is a finished image, no style engine required.
 */
export function tileUrl(t: Tile, token: string, style = "outdoors-v12"): string {
  return `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/512/${t.z}/${t.x}/${t.y}@2x?access_token=${token}`;
}

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

/**
 * Terrain DEM tile.
 *
 * Needed offline as well as the imagery: navigation reads elevation out of
 * this to report how much climbing is left, and the 3-D view is built on it.
 * Without these in the cache both silently degrade on the mountain, which is
 * the one place they matter.
 *
 * The DEM tops out at zoom 14 and is a single 512px tile per cell, so it adds
 * roughly a fifth of what the imagery costs.
 */
export function demTileUrl(t: Tile, token: string): string {
  const z = Math.min(t.z, 14);
  const scale = Math.pow(2, t.z - z);
  const x = Math.floor(t.x / scale);
  const y = Math.floor(t.y / scale);
  return `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/${z}/${x}/${y}@2x.webp?access_token=${token}`;
}

// ---------------------------------------------------------------------------
// Corridor tiling
//
// A bounding box around a long linear trail is mostly map you will never look
// at: the E1 trail's box came to ~132 MB of tiles, the great majority of it
// tens of kilometres from the path. Tiling a corridor along the line instead
// keeps the detail where the walker actually is.
//
// Cheap zooms still use the box — at z10–11 a whole region is a handful of
// tiles and the overview is worth having. The expensive zooms are corridored.
// ---------------------------------------------------------------------------

/** Tile X/Y as floats, so we can measure sub-tile distances. */
function lngToTileXf(lng: number, z: number): number {
  return ((lng + 180) / 360) * Math.pow(2, z);
}
function latToTileYf(lat: number, z: number): number {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z);
}

/**
 * Ground resolution in metres per tile edge at this latitude and zoom.
 * Used to turn a radius in kilometres into a radius in tiles.
 */
export function tileSpanM(lat: number, z: number): number {
  const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
}

/**
 * Every tile within `radiusKm` of any point on any of the lines, at one zoom.
 *
 * Walks each segment in steps smaller than a tile so no tile is skipped on a
 * long straight run, then stamps a disc of tiles around each sample.
 *
 * @param lines  [[lng, lat], ...] per line — the same shape decodeSegments gives
 */
export function tilesAlongLines(
  lines: [number, number][][],
  radiusKm: number,
  z: number
): Tile[] {
  const seen = new Set<string>();
  const out: Tile[] = [];
  const max = Math.pow(2, z);

  const add = (x: number, y: number) => {
    if (y < 0 || y >= max) return; // no tiles past the mercator cutoff
    const wrapped = ((x % max) + max) % max; // antimeridian
    const key = `${wrapped},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ z, x: wrapped, y });
  };

  for (const line of lines) {
    if (line.length === 0) continue;
    for (let i = 0; i < line.length; i++) {
      const [lng, lat] = line[i];
      // Radius in tile units varies with latitude, so recompute per point.
      const rTiles = Math.max(0, (radiusKm * 1000) / tileSpanM(lat, z));
      const cx = lngToTileXf(lng, z);
      const cy = latToTileYf(lat, z);
      const r = Math.ceil(rTiles);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          // Disc, not square: the corners of a square add ~27% more tiles for
          // map the walker is further from than the radius allows.
          if (Math.hypot(dx, dy) > rTiles + 0.75) continue;
          add(Math.floor(cx) + dx, Math.floor(cy) + dy);
        }
      }

      // Step along the segment so a long straight leg can't skip tiles.
      if (i < line.length - 1) {
        const [nlng, nlat] = line[i + 1];
        const steps = Math.ceil(
          Math.max(
            Math.abs(lngToTileXf(nlng, z) - cx),
            Math.abs(latToTileYf(nlat, z) - cy)
          ) * 2
        );
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const ilng = lng + (nlng - lng) * t;
          const ilat = lat + (nlat - lat) * t;
          const irT = Math.max(0, (radiusKm * 1000) / tileSpanM(ilat, z));
          const ix = Math.floor(lngToTileXf(ilng, z));
          const iy = Math.floor(latToTileYf(ilat, z));
          const ir = Math.ceil(irT);
          for (let dx = -ir; dx <= ir; dx++) {
            for (let dy = -ir; dy <= ir; dy++) {
              if (Math.hypot(dx, dy) > irT + 0.75) continue;
              add(ix + dx, iy + dy);
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * The tile plan for downloading a mountain.
 *
 *   z10–11  bounding box     — cheap regional overview
 *   z12–14  corridor         — the detail you navigate by
 *   z15     summit disc only — the top, where precision matters most
 */
export interface MountainTilePlan {
  tiles: Tile[];
  byZoom: Record<number, number>;
  estimatedBytes: number;
}

export function planMountainTiles(
  lines: [number, number][][],
  summit: { lat: number; lng: number },
  { corridorKm = 2.5, summitDiscKm = 2 } = {}
): MountainTilePlan {
  const all: Tile[] = [];
  const pts = lines.flat();
  const withSummit: [number, number][][] = pts.length
    ? lines
    : [[[summit.lng, summit.lat]]];

  const lats = [...pts.map((p) => p[1]), summit.lat];
  const lngs = [...pts.map((p) => p[0]), summit.lng];
  const bbox: BBox = {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };

  all.push(...tilesForBBox(padBBox(bbox, 5), 10, 11));

  // A corridor beats a bounding box by ~14x on a long meandering trail
  // (671 MB → 48 MB for an E1-shaped route), but it *loses* on a short or
  // straight one, where the box is already a thin strip and the corridor's
  // discs spill past its corners. Measure both and keep the smaller — the
  // comparison is pure arithmetic on tile counts, so it is effectively free.
  const paddedBox = padBBox(bbox, corridorKm);
  for (let z = 12; z <= 14; z++) {
    const corridor = tilesAlongLines(withSummit, corridorKm, z);
    const boxed = tilesForBBox(paddedBox, z, z);
    all.push(...(corridor.length <= boxed.length ? corridor : boxed));
  }

  all.push(...tilesAlongLines([[[summit.lng, summit.lat]]], summitDiscKm, 15));

  // One line's corridor can overlap another's.
  const seen = new Set<string>();
  const tiles = all.filter((t) => {
    const k = `${t.z}/${t.x}/${t.y}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });

  const byZoom: Record<number, number> = {};
  for (const t of tiles) byZoom[t.z] = (byZoom[t.z] ?? 0) + 1;

  return { tiles, byZoom, estimatedBytes: estimateBytes(tiles.length) };
}

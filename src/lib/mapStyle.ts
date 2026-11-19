/**
 * Map styles built from the exact tiles a mountain download caches.
 *
 * Why not just use `mapbox://styles/mapbox/satellite-streets-v12`?
 *
 * Because a Mapbox GL style renders from its own endpoints — vector tiles,
 * sprites, glyphs — and the download was caching Static Tiles API rasters
 * (`/styles/v1/{style}/tiles/512/{z}/{x}/{y}`). Those two URL sets never
 * overlap, so the cache could be full and the map would still come up blank
 * the moment the signal went. That is exactly what happened: offline, the
 * peak page rendered its route lines on black.
 *
 * Measured, not assumed:
 *   /styles/v1/mapbox/outdoors-v12/tiles/512/14/2621/6334@2x   → 200, 248 KB
 *   /styles/v1/mapbox/satellite-streets-v12/.../@2x            → 200, 323 KB
 *   DEM tilejson's real template is on tiles.mapbox.com/raster/v1,
 *     NOT api.mapbox.com/v4/...webp, which is what was being cached.
 *
 * Rendering from a raster source of those same URLs makes online and offline
 * identical by construction. The cost is vector labels, which a raster style
 * bakes in rather than placing dynamically — an acceptable trade for a map
 * that actually works on a mountain.
 */

import type { StyleSpecification } from "mapbox-gl";

export type BaseStyle = "satellite" | "outdoors";

export const MAPBOX_STYLE_ID: Record<BaseStyle, string> = {
  satellite: "satellite-streets-v12",
  outdoors: "outdoors-v12",
};

/** Static raster tile for one style. Must match `tileUrl` in tiles.ts. */
export function rasterTemplate(style: BaseStyle, token: string): string {
  return (
    `https://api.mapbox.com/styles/v1/mapbox/${MAPBOX_STYLE_ID[style]}` +
    `/tiles/512/{z}/{x}/{y}@2x?access_token=${token}`
  );
}

/**
 * The terrain DEM tile template.
 *
 * Verified by request, not by reading docs or the TileJSON:
 *   a.tiles.mapbox.com/raster/v1/.../{z}/{x}/{y}.png  → 401 (the template the
 *     TileJSON advertises, which this token cannot use)
 *   api.mapbox.com/v4/.../{z}/{x}/{y}@2x.pngraw       → 200, 168 KB, a real
 *     512×512 PNG
 *   api.mapbox.com/v4/.../{z}/{x}/{y}@2x.webp         → 200, 11 KB
 *
 * .pngraw rather than the much smaller .webp: a DEM encodes elevation in the
 * RGB channels, so any lossy compression silently corrupts the heights this
 * app measures ascent and grade from. 168 KB a tile is worth being right.
 */
export function demTemplate(token: string): string {
  return `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/{z}/{x}/{y}@2x.pngraw?access_token=${token}`;
}

/**
 * Glyphs for the one label this app draws (the summit name).
 *
 * Omitting this is not an option even for a "no labels" style: Mapbox GL
 * rejects any layer with a `text-field` when the style has no `glyphs`, and
 * because addLayer throws inside the style.load handler, the failure took the
 * terrain, the routes and setReady down with it. The map rendered as an empty
 * grey panel with no error visible on the page.
 *
 * Verified: /fonts/v1/mapbox/Open%20Sans%20Regular/0-255.pbf → 200, 73 KB.
 */
export const LABEL_FONT = "Open Sans Regular";
export const GLYPH_RANGES = ["0-255"] as const;

export function glyphUrl(fontstack: string, range: string, token: string): string {
  return `https://api.mapbox.com/fonts/v1/mapbox/${encodeURIComponent(fontstack)}/${range}.pbf?access_token=${token}`;
}

export const DEM_MAXZOOM = 14;
export const DEM_SOURCE_ID = "terrain-dem";
export const BASE_SOURCE_ID = "basemap";

/**
 * A complete style: one raster basemap, one raster-dem for terrain queries
 * and 3-D, and nothing else. Route and marker layers are added by the
 * components on top.
 */
export function buildStyle(style: BaseStyle, token: string): StyleSpecification {
  return {
    version: 8,
    // One font, for the summit label the peak view adds. No sprite: nothing
    // here uses an icon.
    glyphs: `https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf?access_token=${token}`,
    sources: {
      [BASE_SOURCE_ID]: {
        type: "raster",
        tiles: [rasterTemplate(style, token)],
        tileSize: 512,
        maxzoom: 16,
        attribution:
          '<a href="https://www.mapbox.com/about/maps/">© Mapbox</a> <a href="https://www.openstreetmap.org/copyright/">© OpenStreetMap</a>',
      },
      [DEM_SOURCE_ID]: {
        type: "raster-dem",
        tiles: [demTemplate(token)],
        tileSize: 512,
        maxzoom: DEM_MAXZOOM,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#e8eae3" } },
      { id: "basemap", type: "raster", source: BASE_SOURCE_ID, paint: { "raster-opacity": 1 } },
    ],
  } as StyleSpecification;
}

/**
 * Measured average bytes per tile, used for download estimates.
 *
 * The old figure was a flat 25 KB for everything, which told a user on mobile
 * data that Mount Whitney would cost 3.4 MB when it actually cost 54.7 MB.
 */
export const TILE_BYTES: Record<BaseStyle | "dem", number> = {
  satellite: 323 * 1024,
  outdoors: 248 * 1024,
  dem: 168 * 1024,
};

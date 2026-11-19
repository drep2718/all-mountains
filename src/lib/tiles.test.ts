import { describe, it, expect } from "vitest";
import { lngToTileX, latToTileY, tilesForBBox, padBBox, formatBytes } from "./tiles";

describe("tile coordinates", () => {
  it("maps the prime meridian/equator to the expected tile at z1", () => {
    expect(lngToTileX(0, 1)).toBe(1);
    expect(latToTileY(0, 1)).toBe(1);
  });

  it("puts the whole world in one tile at z0", () => {
    expect(lngToTileX(-180, 0)).toBe(0);
    expect(latToTileY(85, 0)).toBe(0);
  });

  it("increases X eastward and Y southward", () => {
    expect(lngToTileX(120, 8)).toBeGreaterThan(lngToTileX(-120, 8));
    expect(latToTileY(-60, 8)).toBeGreaterThan(latToTileY(60, 8));
  });

  it("clamps beyond the Mercator cutoff instead of returning NaN", () => {
    expect(Number.isFinite(latToTileY(90, 10))).toBe(true);
    expect(Number.isFinite(latToTileY(-90, 10))).toBe(true);
  });
});

describe("tilesForBBox", () => {
  const bbox = { minLng: -121.8, minLat: 46.8, maxLng: -121.7, maxLat: 46.9 };

  it("returns exactly one tile at z0", () => {
    expect(tilesForBBox(bbox, 0, 0)).toHaveLength(1);
  });

  it("covers more tiles as zoom increases", () => {
    expect(tilesForBBox(bbox, 12, 12).length).toBeGreaterThan(
      tilesForBBox(bbox, 10, 10).length
    );
  });

  it("includes every zoom in the range", () => {
    const zooms = new Set(tilesForBBox(bbox, 10, 13).map((t) => t.z));
    expect([...zooms].sort()).toEqual([10, 11, 12, 13]);
  });

  it("never emits an out-of-range tile index", () => {
    for (const t of tilesForBBox({ minLng: -180, minLat: -85, maxLng: 180, maxLat: 85 }, 3, 3)) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThan(8);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThan(8);
    }
  });

  it("emits no duplicate tiles", () => {
    const tiles = tilesForBBox(bbox, 10, 14);
    const keys = new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
    expect(keys.size).toBe(tiles.length);
  });
});

describe("padBBox", () => {
  it("grows the box in every direction", () => {
    const b = { minLng: -121.8, minLat: 46.8, maxLng: -121.7, maxLat: 46.9 };
    const p = padBBox(b, 5);
    expect(p.minLat).toBeLessThan(b.minLat);
    expect(p.maxLat).toBeGreaterThan(b.maxLat);
    expect(p.minLng).toBeLessThan(b.minLng);
    expect(p.maxLng).toBeGreaterThan(b.maxLng);
  });

  it("stays inside valid coordinate bounds near the poles", () => {
    const p = padBBox({ minLng: -180, minLat: -84.9, maxLng: 180, maxLat: 84.9 }, 500);
    expect(p.minLat).toBeGreaterThanOrEqual(-85);
    expect(p.maxLat).toBeLessThanOrEqual(85);
    expect(p.minLng).toBeGreaterThanOrEqual(-180);
    expect(p.maxLng).toBeLessThanOrEqual(180);
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

// --- corridor tiling -------------------------------------------------------

import { tilesAlongLines, planMountainTiles, tileSpanM } from "./tiles";

/** A roughly north-south line of `km` length starting at (lat, lng). */
function straightLine(lat: number, lng: number, km: number, points = 50): [number, number][] {
  const dLat = km / 110.574 / (points - 1);
  return Array.from({ length: points }, (_, i) => [lng, lat + dLat * i] as [number, number]);
}

describe("tilesAlongLines", () => {
  it("returns tiles for a single point", () => {
    const tiles = tilesAlongLines([[[-121.76, 46.85]]], 1, 13);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.z === 13)).toBe(true);
  });

  it("never returns duplicate tiles", () => {
    const tiles = tilesAlongLines([straightLine(46.85, -121.76, 20)], 2, 13);
    const keys = new Set(tiles.map((t) => `${t.x}/${t.y}`));
    expect(keys.size).toBe(tiles.length);
  });

  it("covers a long straight line with no gaps in the y sequence", () => {
    // A gap would mean a walker hits blank map partway along the trail.
    const tiles = tilesAlongLines([straightLine(46.85, -121.76, 40, 3)], 0.1, 13);
    const ys = [...new Set(tiles.map((t) => t.y))].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBe(1);
    }
  });

  it("grows with radius and with zoom", () => {
    const line = [straightLine(46.85, -121.76, 10)];
    expect(tilesAlongLines(line, 4, 13).length).toBeGreaterThan(
      tilesAlongLines(line, 1, 13).length
    );
    expect(tilesAlongLines(line, 2, 14).length).toBeGreaterThan(
      tilesAlongLines(line, 2, 13).length
    );
  });

  it("stays inside the valid tile range and wraps the antimeridian", () => {
    // Radius must exceed one tile's span to straddle 180° at all: a tile is
    // ~9.8 km wide at z12 on the equator, so 30 km spans several.
    const z = 12;
    const tiles = tilesAlongLines([[[179.99, 0]]], 30, z);
    const max = 2 ** z;
    expect(tiles.every((t) => t.x >= 0 && t.x < max && t.y >= 0 && t.y < max)).toBe(true);
    expect(tiles.some((t) => t.x < 5)).toBe(true);
    expect(tiles.some((t) => t.x > max - 5)).toBe(true);
  });

  it("clamps rather than emitting tiles past the mercator cutoff", () => {
    const tiles = tilesAlongLines([[[0, 84.9]]], 50, 10);
    expect(tiles.every((t) => t.y >= 0 && t.y < 2 ** 10)).toBe(true);
  });

  it("handles empty input", () => {
    expect(tilesAlongLines([], 2, 13)).toEqual([]);
    expect(tilesAlongLines([[]], 2, 13)).toEqual([]);
  });

  it("tileSpanM shrinks toward the poles", () => {
    expect(tileSpanM(0, 12)).toBeGreaterThan(tileSpanM(60, 12));
  });
});

describe("planMountainTiles", () => {
  it("is dramatically smaller than a bounding box on a long trail", () => {
    // The case that made this necessary: a 300 km trail's bbox came to ~132 MB.
    const line = straightLine(46.0, 8.0, 300, 300);
    const plan = planMountainTiles([line], { lat: 46.0, lng: 8.0 });
    const bboxTiles = tilesForBBox(padBBox(
      { minLat: 46.0, maxLat: 46.0 + 300 / 110.574, minLng: 7.9, maxLng: 8.1 }, 3
    ), 10, 14).length;
    expect(plan.tiles.length).toBeLessThan(bboxTiles * 0.5);
  });

  it("covers every zoom in the plan", () => {
    const plan = planMountainTiles([straightLine(46.85, -121.76, 8)], {
      lat: 46.85, lng: -121.76,
    });
    for (const z of [10, 11, 12, 13, 14, 15]) {
      expect(plan.byZoom[z], `zoom ${z} missing`).toBeGreaterThan(0);
    }
  });

  it("still produces a usable plan for a peak with no routes", () => {
    const plan = planMountainTiles([], { lat: 27.9881, lng: 86.925 });
    expect(plan.tiles.length).toBeGreaterThan(0);
    expect(plan.byZoom[15]).toBeGreaterThan(0);
  });

  it("returns no duplicate tiles across zooms", () => {
    const plan = planMountainTiles([straightLine(46.85, -121.76, 15)], {
      lat: 46.85, lng: -121.76,
    });
    const keys = new Set(plan.tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
    expect(keys.size).toBe(plan.tiles.length);
  });
});

describe("planMountainTiles picks the cheaper strategy", () => {
  it("never costs more than a plain bounding box at the expensive zooms", () => {
    const shapes: Record<string, [number, number][]> = {
      straight: Array.from({ length: 200 }, (_, i) => [8, 46 + i * 0.0045]),
      diagonal: Array.from({ length: 200 }, (_, i) => [8 + i * 0.0045, 46 + i * 0.0031]),
      loop: Array.from({ length: 120 }, (_, i) => {
        const a = (i / 119) * 2 * Math.PI;
        return [-121.76 + 0.12 * Math.cos(a), 46.85 + 0.09 * Math.sin(a)];
      }),
    };
    for (const [name, line] of Object.entries(shapes)) {
      const lats = line.map((p) => p[1]);
      const lngs = line.map((p) => p[0]);
      const box = {
        minLat: Math.min(...lats), maxLat: Math.max(...lats),
        minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
      };
      const plan = planMountainTiles([line], { lat: lats[0], lng: lngs[0] });
      const planExpensive = [12, 13, 14].reduce((n, z) => n + (plan.byZoom[z] ?? 0), 0);
      let bboxExpensive = 0;
      for (let z = 12; z <= 14; z++) bboxExpensive += tilesForBBox(padBBox(box, 2.5), z, z).length;
      // Equal is fine (it chose the box); more is not.
      expect(planExpensive, `${name} should not exceed bbox`).toBeLessThanOrEqual(bboxExpensive);
    }
  });
});

describe("demTileUrl", () => {
  it("points at the terrain DEM and carries the token", async () => {
    const { demTileUrl } = await import("./tiles");
    const u = demTileUrl({ z: 14, x: 2621, y: 6334 }, "tok");
    expect(u).toContain("mapbox.mapbox-terrain-dem-v1");
    expect(u).toContain("access_token=tok");
    expect(u).toContain("/14/2621/6334");
  });

  it("collapses zooms above 14 onto the DEM's own maximum", async () => {
    const { demTileUrl } = await import("./tiles");
    // z15 tile (x,y) maps to the z14 parent (x>>1, y>>1)
    const u = demTileUrl({ z: 15, x: 5242, y: 12668 }, "tok");
    expect(u).toContain("/14/2621/6334");
  });

  it("is stable, so repeated downloads reuse the cached tile", async () => {
    const { demTileUrl } = await import("./tiles");
    expect(demTileUrl({ z: 12, x: 655, y: 1583 }, "tok")).toBe(
      demTileUrl({ z: 12, x: 655, y: 1583 }, "tok")
    );
  });
});

describe("downloaded tile URLs match what the renderer requests", () => {
  it("the basemap template and the downloaded tile are the same endpoint", async () => {
    const { tileUrl } = await import("./tiles");
    const { rasterTemplate } = await import("./mapStyle");
    const fromTemplate = rasterTemplate("outdoors", "tok")
      .replace("{z}", "14").replace("{x}", "2621").replace("{y}", "6334");
    expect(tileUrl({ z: 14, x: 2621, y: 6334 }, "tok", "outdoors-v12")).toBe(fromTemplate);
  });

  it("the satellite template matches too", async () => {
    const { tileUrl } = await import("./tiles");
    const { rasterTemplate } = await import("./mapStyle");
    const fromTemplate = rasterTemplate("satellite", "tok")
      .replace("{z}", "12").replace("{x}", "655").replace("{y}", "1583");
    expect(tileUrl({ z: 12, x: 655, y: 1583 }, "tok", "satellite-streets-v12")).toBe(fromTemplate);
  });

  it("the DEM template and the downloaded DEM tile are the same endpoint", async () => {
    const { demTileUrl } = await import("./tiles");
    const { demTemplate } = await import("./mapStyle");
    const fromTemplate = demTemplate("tok")
      .replace("{z}", "14").replace("{x}", "2621").replace("{y}", "6334");
    expect(demTileUrl({ z: 14, x: 2621, y: 6334 }, "tok")).toBe(fromTemplate);
  });

  it("the service worker will cache every host these URLs use", async () => {
    const { readFileSync } = await import("node:fs");
    const sw = readFileSync("public/sw.js", "utf8");
    const { rasterTemplate, demTemplate } = await import("./mapStyle");
    for (const u of [rasterTemplate("satellite", "t"), demTemplate("t")]) {
      const host = new URL(u.replace(/\{[zxy]\}/g, "1")).hostname;
      // isMapboxAsset matches any *.mapbox.com host
      expect(sw).toContain('hostname.endsWith("mapbox.com")');
      expect(host.endsWith("mapbox.com")).toBe(true);
    }
  });
});

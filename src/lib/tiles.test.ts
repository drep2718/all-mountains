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

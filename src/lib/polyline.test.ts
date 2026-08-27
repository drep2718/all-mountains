import { describe, it, expect } from "vitest";
import {
  encodePolyline, decodePolyline, encodeSegments, decodeSegments,
  simplify, toStored, type LngLat,
} from "./polyline";

// Precision 5 stores ~1 m; anything within 2e-5 degrees is a faithful round-trip.
const PRECISION = 2e-5;

function expectClose(actual: LngLat[], expected: LngLat[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach(([lng, lat], i) => {
    expect(lng).toBeCloseTo(expected[i][0], 4);
    expect(lat).toBeCloseTo(expected[i][1], 4);
  });
}

describe("encode/decode round-trip", () => {
  it("round-trips a real trail segment", () => {
    const coords: LngLat[] = [
      [-121.7603, 46.8523], [-121.7598, 46.8531],
      [-121.7590, 46.8540], [-121.7575, 46.8552],
    ];
    expectClose(decodePolyline(encodePolyline(coords)), coords);
  });

  it("round-trips across the equator and prime meridian", () => {
    const coords: LngLat[] = [[-0.001, -0.001], [0, 0], [0.001, 0.001]];
    expectClose(decodePolyline(encodePolyline(coords)), coords);
  });

  it("round-trips southern and eastern hemispheres", () => {
    const coords: LngLat[] = [[138.7274, 35.3606], [174.7633, -36.8485]];
    expectClose(decodePolyline(encodePolyline(coords)), coords);
  });

  it("keeps every point within ~1 m", () => {
    const coords: LngLat[] = Array.from({ length: 200 }, (_, i) => [
      -121.76 + i * 0.0001,
      46.85 + i * 0.00007,
    ]);
    const out = decodePolyline(encodePolyline(coords));
    out.forEach(([lng, lat], i) => {
      expect(Math.abs(lng - coords[i][0])).toBeLessThan(PRECISION);
      expect(Math.abs(lat - coords[i][1])).toBeLessThan(PRECISION);
    });
  });

  it("handles a single point and an empty list", () => {
    expectClose(decodePolyline(encodePolyline([[1, 2]])), [[1, 2]]);
    expect(encodePolyline([])).toBe("");
    expect(decodePolyline("")).toEqual([]);
  });

  it("never returns NaN from malformed input", () => {
    for (const [lng, lat] of decodePolyline("!!!garbage!!!")) {
      expect(Number.isFinite(lng)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
    }
  });
});

describe("segments (MultiLineString)", () => {
  it("round-trips multiple disjoint segments", () => {
    const lines: LngLat[][] = [
      [[-121.76, 46.85], [-121.75, 46.86]],
      [[-121.70, 46.90], [-121.69, 46.91]],
    ];
    const out = decodeSegments(encodeSegments(lines));
    expect(out).toHaveLength(2);
    expectClose(out[0], lines[0]);
    expectClose(out[1], lines[1]);
  });

  it("round-trips a single segment", () => {
    const lines: LngLat[][] = [[[-121.76, 46.85], [-121.75, 46.86]]];
    expect(decodeSegments(encodeSegments(lines))).toHaveLength(1);
  });

  it("treats null/empty storage as no geometry", () => {
    expect(decodeSegments(null)).toEqual([]);
    expect(decodeSegments(undefined)).toEqual([]);
    expect(decodeSegments("")).toEqual([]);
  });
});

describe("simplify", () => {
  it("collapses collinear points", () => {
    const straight: LngLat[] = Array.from({ length: 50 }, (_, i) => [i * 0.001, 0]);
    expect(simplify(straight).length).toBe(2);
  });

  it("keeps the endpoints exactly", () => {
    const coords: LngLat[] = Array.from({ length: 30 }, (_, i) => [
      i * 0.001, Math.sin(i) * 0.001,
    ]);
    const out = simplify(coords);
    expect(out[0]).toEqual(coords[0]);
    expect(out[out.length - 1]).toEqual(coords[coords.length - 1]);
  });

  it("keeps points that genuinely bend the line", () => {
    // A sharp switchback must survive — it is the shape of the trail.
    const zigzag: LngLat[] = [[0, 0], [0.001, 0.01], [0.002, 0], [0.003, 0.01]];
    expect(simplify(zigzag).length).toBe(4);
  });

  it("leaves 2-point lines alone", () => {
    const two: LngLat[] = [[0, 0], [1, 1]];
    expect(simplify(two)).toEqual(two);
  });

  it("shrinks a dense GPS trace substantially", () => {
    // A noisy but essentially straight trace — what OSM traces look like.
    const dense: LngLat[] = Array.from({ length: 500 }, (_, i) => [
      i * 0.00002,
      Math.sin(i / 50) * 0.00003,
    ]);
    expect(simplify(dense).length).toBeLessThan(dense.length / 4);
  });
});

describe("toStored", () => {
  it("produces a decodable string much smaller than GeoJSON", () => {
    const line: LngLat[] = Array.from({ length: 400 }, (_, i) => [
      -121.76 + i * 0.00005,
      46.85 + i * 0.00004,
    ]);
    const stored = toStored([line]);
    const geojson = JSON.stringify({ type: "LineString", coordinates: line });

    expect(stored.length).toBeLessThan(geojson.length / 8);
    expect(decodeSegments(stored)[0].length).toBeGreaterThan(1);
  });

  it("keeps the route recognisable after simplification", () => {
    const line: LngLat[] = [
      [-121.7603, 46.8523], [-121.7598, 46.8531],
      [-121.7590, 46.8540], [-121.7575, 46.8552],
    ];
    const out = decodeSegments(toStored([line]))[0];
    // Endpoints must survive: they are the trailhead and the summit.
    expect(out[0][0]).toBeCloseTo(line[0][0], 4);
    expect(out[out.length - 1][0]).toBeCloseTo(line[line.length - 1][0], 4);
  });
});

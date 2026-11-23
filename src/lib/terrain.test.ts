import { describe, expect, it } from "vitest";
import type mapboxgl from "mapbox-gl";
import { assessHazards, estimateMinutes, haversineM, profileFromTerrain, resample, type HazardInput, type RouteProfile } from "./terrain";
import type { LngLat } from "./polyline";

const metresToDegrees = 180 / (Math.PI * 6_371_000);
const point = (m: number): LngLat => [0, m * metresToDegrees];
const line: LngLat[] = [point(0), point(900)];

function terrain(values: (number | null)[]) {
  let index = 0;
  return { queryTerrainElevation: () => values[Math.min(index++, values.length - 1)] } as unknown as mapboxgl.Map;
}

function profile(values: (number | null)[]) {
  return profileFromTerrain(terrain(values), line, { stepM: 30 })!;
}

describe("terrain resampling", () => {
  it("spaces samples evenly despite clustered and duplicate input vertices", () => {
    const pts = resample([point(0), point(1), point(1), point(3), point(800), point(900)], 30);
    expect(pts[0]).toEqual(point(0));
    expect(pts.at(-1)).toEqual(point(900));
    const gaps = pts.slice(1).map((p, i) => haversineM(pts[i][1], pts[i][0], p[1], p[0]));
    for (const gap of gaps.slice(0, -1)) expect(gap).toBeCloseTo(30, 5);
    expect(gaps.at(-1)).toBeLessThanOrEqual(30.00001);
  });

  it("handles empty, single-point and coincident lines", () => {
    expect(resample([])).toEqual([]);
    expect(resample([point(2)])).toEqual([point(2)]);
    expect(resample([point(2), point(2)])).toEqual([point(2)]);
  });

  it("keeps long routes inside the sampling budget, including endpoints", () => {
    const pts = resample([point(0), point(100000)], 30, 40);
    expect(pts.length).toBeLessThanOrEqual(40);
    expect(pts.at(-1)).toEqual(point(100000));
  });
});

describe("profiles from a synthetic DEM", () => {
  it("returns null rather than a fabricated flat profile while a tile is missing", () => {
    expect(profileFromTerrain(terrain([null]), line)).toBeNull();
    expect(profileFromTerrain(terrain([10, 10, null]), line)).toBeNull();
    expect(profileFromTerrain(terrain([10]), [])).toBeNull();
  });

  it("rejects non-finite elevation readings", () => {
    expect(profileFromTerrain(terrain([NaN]), line)).toBeNull();
    expect(profileFromTerrain(terrain([Infinity]), line)).toBeNull();
  });

  it("the five-point median removes isolated DEM spikes and their invented ascent", () => {
    const values = Array(32).fill(1000);
    values[8] = 1600;
    values[21] = 400;
    const p = profile(values);
    expect(p.ascentM).toBe(0);
    expect(p.descentM).toBe(0);
    expect(p.maxGrade).toBe(0);
    expect(p.minEle).toBe(1000);
    expect(p.maxEle).toBe(1000);
  });

  it("counts a long climb whose individual rises are all under two metres", () => {
    const p = profile(Array.from({ length: 40 }, (_, i) => 1000 + i));
    expect(p.ascentM).toBeGreaterThanOrEqual(28);
    expect(p.ascentM).toBeLessThanOrEqual(31);
    expect(p.descentM).toBe(0);
    expect(p.distanceKm).toBeCloseTo(0.9, 5);
  });

  it("ignores metre-scale jitter on flat terrain", () => {
    const p = profile(Array.from({ length: 40 }, (_, i) => 1000 + (i % 2 ? 0.8 : 0)));
    expect(p.ascentM).toBe(0);
    expect(p.descentM).toBe(0);
  });

  it("measures descent, signed segment grade and distance on an even slope", () => {
    const p = profile(Array.from({ length: 40 }, (_, i) => 2000 - i * 9));
    expect(p.ascentM).toBe(0);
    expect(p.descentM).toBeCloseTo(270, -1);
    expect(p.maxGrade).toBe(30);
    expect(p.samples[5].grade).toBeCloseTo(-30, 3);
    expect(p.steepFraction).toBeGreaterThan(0.9);
  });
});

describe("walking time", () => {
  it("combines distance and ascent and scales for scrambling and climbing", () => {
    expect(estimateMinutes(5, 600, 0)).toBe(120);
    expect(estimateMinutes(5, 600, 0, "scramble")).toBe(168);
    expect(estimateMinutes(5, 600, 0, "technical")).toBe(240);
  });
  it("Langmuir subtracts time for gentle descent and adds it above a 12% grade", () => {
    expect(estimateMinutes(5, 0, 300)).toBe(50);
    expect(estimateMinutes(5, 0, 600)).toBe(40);
    expect(estimateMinutes(5, 0, 900)).toBe(90);
  });
  it("keeps a five-minute minimum for very short routes", () => {
    expect(estimateMinutes(0, 0, 0)).toBe(5);
    expect(estimateMinutes(0.1, 0, 100)).toBe(5);
  });
});

const input: HazardInput = { summitElevationM: 1000, difficulty: "hike", latitude: 40, month: 6 };
const hazards = (patch: Partial<HazardInput>) => assessHazards({ ...input, ...patch });

describe("terrain hazard boundaries", () => {
  it.each([
    [2499, undefined], [2500, "Moderate altitude"], [3499, "Moderate altitude"],
    [3500, "High altitude"], [4999, "High altitude"], [5000, "Extreme altitude"],
  ])("selects a single altitude band at %i m", (elevation, title) => {
    const altitude = hazards({ summitElevationM: elevation }).filter((h) => /altitude/i.test(h.title));
    expect(altitude.map((h) => h.title)).toEqual(title ? [title] : []);
  });

  /**
   * The season half of this panel now comes from `seasonalGrade`, so that
   * it and the difficulty badge cannot describe the same month
   * differently. These expectations changed with it, deliberately:
   * April and October are shoulder months rather than winter, and the
   * snow line is a continuous function of latitude instead of three
   * buckets. See src/lib/season.test.ts for the model's own tests.
   */
  it.each([0, 1, 2, 10, 11])("recognises northern winter in month %i", (month) => {
    expect(hazards({ summitElevationM: 3000, month }).some((h) => /Winter conditions/.test(h.title))).toBe(true);
  });

  it.each([4, 5, 6, 7, 8])("recognises southern winter in month %i", (month) => {
    expect(hazards({ summitElevationM: 3000, latitude: -40, month }).some((h) => /Winter conditions/.test(h.title))).toBe(true);
  });

  it("switches seasons between hemispheres and handles shoulder months", () => {
    expect(hazards({ summitElevationM: 3000, month: 6 }).some((h) => /Winter|snow/i.test(h.title))).toBe(false);
    expect(hazards({ summitElevationM: 3000, latitude: -40, month: 0 }).some((h) => /Winter|snow/i.test(h.title))).toBe(false);
    // April north, October south: autumn/spring on either side.
    expect(hazards({ summitElevationM: 3000, month: 3 }).some((h) => /Snow/i.test(h.title))).toBe(true);
    expect(hazards({ summitElevationM: 3000, latitude: -40, month: 9 }).some((h) => /Snow/i.test(h.title))).toBe(true);
  });

  it("lowers the seasonal snowline at high latitudes", () => {
    // At 65° the line is about 250 m, so a 300 m hill is above it in
    // January and a 200 m one is not. The old bucketed model put the line
    // at a flat 600 m here and at 2,500 m for everything below 45°, which
    // is what hid Mount Washington's winter entirely.
    expect(hazards({ latitude: 65, summitElevationM: 300, month: 0 }).some((h) => /Winter conditions/.test(h.title))).toBe(true);
    expect(hazards({ latitude: 65, summitElevationM: 200, month: 0 }).some((h) => /Winter conditions/.test(h.title))).toBe(false);
    expect(hazards({ latitude: 50, summitElevationM: 1500, month: 0 }).some((h) => /Winter conditions/.test(h.title))).toBe(true);
    expect(hazards({ latitude: 44.27, summitElevationM: 1917, month: 1 }).some((h) => /Winter conditions/.test(h.title))).toBe(true);
  });

  it("uses measured grade/ascent and puts serious hazards first", () => {
    const p = { maxGrade: 45, ascentM: 1500, steepFraction: 0.3 } as RouteProfile;
    const result = hazards({ profile: p, difficulty: "scramble" });
    expect(result[0]).toMatchObject({ level: "serious" });
    expect(result.some((h) => /Big day/.test(h.title))).toBe(true);
    expect(hazards({ profile: { ...p, maxGrade: 30 } }).some((h) => h.level === "caution" && /Steep/.test(h.title))).toBe(true);
    expect(hazards({ profile: { ...p, maxGrade: 29, ascentM: 1499 } })).toHaveLength(0);
  });

  it("respects wind, freezing and storm thresholds", () => {
    const result = hazards({ weather: { windKph: 60, tempC: -10, code: 95 } });
    expect(result).toHaveLength(3);
    expect(result.every((h) => h.level === "serious")).toBe(true);
    expect(hazards({ weather: { windKph: 35, tempC: 0, code: 71 } })).toHaveLength(3);
    expect(hazards({ weather: { windKph: 34, tempC: 1, code: 0 } })).toHaveLength(0);
  });
});

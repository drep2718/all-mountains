import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, FEATURES, ACTIVITIES, routeMatches } from "./filters";

const route = { difficulty: "Expert", route_type: "Out & Back", distance_km: 6, is_summit_route: true };
const peak = { difficulty: "hike" as const, category: "highpoint" as const };

describe("peaks-first route filters", () => {
  it("uses the catalogue's climb difficulty while preserving the OSM route grade", () => {
    expect(routeMatches(route, { ...DEFAULT_FILTERS, difficulty: ["hike"] }, peak)).toBe(true);
    expect(routeMatches(route, { ...DEFAULT_FILTERS, difficulty: ["technical"] }, peak)).toBe(false);
  });
  it("selects summit access and highpoints from fields that actually exist", () => {
    const filters = { ...DEFAULT_FILTERS, iconicOnly: true, features: ["Summits"] };
    expect(routeMatches(route, filters, peak)).toBe(true);
    expect(routeMatches({ ...route, is_summit_route: false }, filters, peak)).toBe(false);
    expect(routeMatches(route, filters, { ...peak, category: "popular" })).toBe(false);
  });
  it("does not claim an unknown distance satisfies a length constraint", () => {
    expect(routeMatches({ ...route, distance_km: null }, { ...DEFAULT_FILTERS, lengthMax: 10 }, peak)).toBe(false);
    expect(routeMatches({ ...route, distance_km: null }, DEFAULT_FILTERS, peak)).toBe(true);
  });
  it("keeps the upper length cap open-ended", () => {
    expect(routeMatches({ ...route, distance_km: 80 }, DEFAULT_FILTERS, peak)).toBe(true);
    expect(routeMatches(route, { ...DEFAULT_FILTERS, routeType: ["Loop"] }, peak)).toBe(false);
  });
  it("offers only activity and feature options supported by this catalogue", () => {
    expect(ACTIVITIES).toEqual(["Hiking"]);
    expect(FEATURES).toEqual(["Summits"]);
  });
});

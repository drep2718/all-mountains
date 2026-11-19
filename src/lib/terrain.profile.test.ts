import { describe, expect, it } from "vitest";
import { profileFromSamples, estimateMinutes, resample } from "@/lib/terrain";
import type { LngLat } from "@/lib/polyline";

/**
 * `profileFromSamples` is shared by the browser (which reads the loaded
 * terrain) and the offline elevation pass (which reads DEM tiles in Node). If
 * it ever stops being the single source of ascent, a route's stored `ascent_m`
 * can disagree with the profile drawn directly underneath it on the page.
 */

/** A straight 3 km line, used to turn an elevation series into a profile. */
function line(points: number): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < points; i++) out.push([-118.29 + i * 0.0003, 36.578]);
  return out;
}

describe("profileFromSamples", () => {
  it("measures a steady climb", () => {
    const pts = line(100);
    const ele = pts.map((_, i) => 2000 + i * 10); // +990 m over the line
    const p = profileFromSamples(pts, ele);
    expect(p.ascentM).toBe(990);
    expect(p.descentM).toBe(0);
    expect(p.minEle).toBe(2000);
    expect(p.maxEle).toBe(2990);
  });

  it("does not invent climb out of sub-threshold jitter", () => {
    const pts = line(200);
    // Flat ground wobbling ±0.5 m. Summed raw that is ~100 m of phantom
    // ascent, which is how gain figures end up absurd. Note a 5-point median
    // does *not* remove perfect alternation — the median of [+1,-1,+1,-1,+1]
    // is +1 — so it is the 2 m threshold, not `denoise`, that kills this.
    const ele = pts.map((_, i) => 2000 + (i % 2 ? 0.5 : -0.5));
    const p = profileFromSamples(pts, ele);
    expect(p.ascentM).toBe(0);
    expect(p.descentM).toBe(0);
  });

  it("removes an isolated spike", () => {
    const pts = line(60);
    const ele = pts.map((_, i) => (i === 30 ? 2400 : 2000)); // one bad pixel
    const p = profileFromSamples(pts, ele);
    expect(p.ascentM).toBe(0);
    expect(p.maxEle).toBe(2000);
  });

  it("counts a long gentle climb that never steps 2 m at once", () => {
    const pts = line(120);
    // 0.5 m per sample: below the threshold pairwise, 59 m in total. Measured
    // against the last committed level, so it still counts.
    const ele = pts.map((_, i) => 2000 + i * 0.5);
    const p = profileFromSamples(pts, ele);
    expect(p.ascentM).toBeGreaterThan(50);
    expect(p.ascentM).toBeLessThanOrEqual(60);
  });

  it("separates ascent from descent over a saddle", () => {
    const pts = line(101);
    const ele = pts.map((_, i) => (i <= 50 ? 2000 + i * 10 : 2500 - (i - 50) * 10));
    const p = profileFromSamples(pts, ele);
    // Not exactly 500: the median window clips the apex by one step, which is
    // the price of not counting jitter as climb.
    expect(p.ascentM).toBeGreaterThan(485);
    expect(p.ascentM).toBeLessThanOrEqual(500);
    expect(p.descentM).toBeGreaterThan(485);
    expect(p.descentM).toBeLessThanOrEqual(500);
  });

  it("reports sustained grade, not one cliff-edge pixel pair", () => {
    const pts = line(100);
    // Gentle throughout except a single 60 m step between two samples.
    const ele = pts.map((_, i) => 2000 + i * 0.3 + (i === 50 ? 60 : 0));
    const p = profileFromSamples(pts, ele);
    // The spike is a 200% pairwise grade; over the 200 m window it is not.
    expect(p.maxGrade).toBeLessThan(60);
  });
});

describe("estimateMinutes", () => {
  it("is not the flat-walking time the importer stored as a placeholder", () => {
    // Mount Whitney main trail: 17 km, ~1,860 m of climb.
    const flat = Math.round(17 * 12 + 0); // what naismith(km, null) produced
    const real = estimateMinutes(17, 1860, 1860, "hike");
    expect(flat).toBe(204); // 3h24 — the placeholder, and plainly wrong
    expect(real).toBeGreaterThan(flat * 1.5);
    // ~5h30. Naismith is still optimistic against the 12-15 h most parties
    // take, so the figure is a floor, not a promise — but it is the right
    // order of magnitude, which the placeholder was not.
    expect(real).toBeGreaterThan(300);
    expect(real).toBeLessThan(420);
  });

  it("charges more for scrambling and climbing than for walking", () => {
    const hike = estimateMinutes(10, 1000, 1000, "hike");
    expect(estimateMinutes(10, 1000, 1000, "scramble")).toBeGreaterThan(hike);
    expect(estimateMinutes(10, 1000, 1000, "technical")).toBeGreaterThan(
      estimateMinutes(10, 1000, 1000, "scramble")
    );
  });

  it("never returns a non-positive time", () => {
    expect(estimateMinutes(0, 0, 0, "hike")).toBeGreaterThan(0);
  });
});

describe("resample", () => {
  it("keeps both endpoints so a route still reaches its summit", () => {
    const l = line(50);
    const r = resample(l, 30, 400);
    expect(r[0]).toEqual(l[0]);
    expect(r[r.length - 1]).toEqual(l[l.length - 1]);
  });
});

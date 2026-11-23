import { describe, expect, it } from "vitest";
import { seasonFor, seasonalGrade, winterSnowLineM } from "@/lib/season";

/** The peaks this model is judged against, with their real figures. */
const WASHINGTON = { latitude: 44.27, elevationM: 1917, difficulty: "hike" as const };
const WHITNEY = { latitude: 36.58, elevationM: 4421, difficulty: "hike" as const };
const FLATTOP_AK = { latitude: 61.09, elevationM: 1070, difficulty: "hike" as const };
const KILIMANJARO = { latitude: -3.07, elevationM: 5895, difficulty: "hike" as const };
const ACONCAGUA = { latitude: -32.65, elevationM: 6962, difficulty: "hike" as const };
const MONTE_SANO = { latitude: 34.73, elevationM: 500, difficulty: "hike" as const };

const JAN = 0, FEB = 1, APR = 3, JUL = 6, OCT = 9, NOV = 10;

describe("winterSnowLineM", () => {
  it("is continuous, not bucketed — the Mount Washington bug", () => {
    // The old model used >45° and >60° buckets, so Washington at 44.27°
    // was handed a 2,500 m snow line, its 1,917 m summit counted as below
    // it, and it drew no winter warning at all.
    expect(winterSnowLineM(44.27)).toBeLessThan(1917);
    // And the bucket edge no longer produces a cliff.
    expect(Math.abs(winterSnowLineM(45.1) - winterSnowLineM(44.9))).toBeLessThan(30);
  });

  it("lands near the accepted figures", () => {
    expect(winterSnowLineM(0)).toBeGreaterThan(4000);
    expect(winterSnowLineM(60)).toBeLessThan(900);
    expect(winterSnowLineM(80)).toBe(0); // never negative
  });
});

describe("seasonFor", () => {
  it("inverts across the equator", () => {
    expect(seasonFor(45, JAN)).toBe("winter");
    expect(seasonFor(-45, JAN)).toBe("summer");
    expect(seasonFor(45, JUL)).toBe("summer");
    expect(seasonFor(-45, JUL)).toBe("winter");
  });

  it("has no winter in the tropics", () => {
    for (let m = 0; m < 12; m++) {
      expect(seasonFor(0, m)).toBe("tropical");
      expect(seasonFor(-3.07, m)).toBe("tropical");
      expect(seasonFor(23, m)).toBe("tropical");
    }
  });
});

describe("seasonalGrade", () => {
  it("turns Mount Washington from a walk-up into a climb in February", () => {
    const summer = seasonalGrade({ ...WASHINGTON, from: JUL });
    expect(summer.effective).toBe("hike");
    expect(summer.steps).toBe(0);

    const winter = seasonalGrade({ ...WASHINGTON, from: FEB });
    expect(winter.season).toBe("winter");
    expect(winter.snowLikely).toBe(true);
    expect(winter.steps).toBeGreaterThan(0);
    expect(winter.effective).not.toBe("hike");
    expect(winter.detail).toMatch(/axe|crampons/i);
  });

  it("never grades a mountain easier than the catalogue says", () => {
    // The catalogue grade already describes the best day of the year.
    for (let m = 0; m < 12; m++) {
      for (const peak of [WASHINGTON, WHITNEY, KILIMANJARO, ACONCAGUA]) {
        expect(seasonalGrade({ ...peak, from: m }).steps).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("caps at technical — nothing is harder", () => {
    const g = seasonalGrade({ ...FLATTOP_AK, difficulty: "technical", from: JAN });
    expect(g.effective).toBe("technical");
  });

  it("escalates two grades where winter is severe at any height", () => {
    // 61°N: winter is serious on a 1,070 m hill.
    const g = seasonalGrade({ ...FLATTOP_AK, from: JAN });
    expect(g.steps).toBe(2);
    expect(g.effective).toBe("technical");
  });

  it("leaves a low peak alone in winter", () => {
    const g = seasonalGrade({ ...MONTE_SANO, from: JAN });
    expect(g.season).toBe("winter");
    expect(g.steps).toBe(0);
    expect(g.snowLikely).toBe(false);
    expect(g.detail).toMatch(/below the usual snow line/i);
  });

  it("inverts for the southern hemisphere", () => {
    // Aconcagua: January is high summer, July is deep winter.
    expect(seasonalGrade({ ...ACONCAGUA, from: JAN }).steps).toBe(0);
    expect(seasonalGrade({ ...ACONCAGUA, from: JUL }).steps).toBeGreaterThan(0);
  });

  it("does not invent a winter for a tropical peak", () => {
    const g = seasonalGrade({ ...KILIMANJARO, from: JAN });
    expect(g.season).toBe("tropical");
    expect(g.steps).toBe(0);
    expect(g.detail).toMatch(/wet and dry/i);
    // But it is honest that the summit is freezing regardless.
    expect(g.snowLikely).toBe(true);
  });

  it("warns about lingering snow in the shoulder months", () => {
    const g = seasonalGrade({ ...WHITNEY, from: APR });
    expect(g.season).toBe("shoulder");
    expect(g.snowLikely).toBe(true);
  });

  it("reports the hardest month of a range, not an average", () => {
    // July alone is easy; a July–January trip has to be ready for January.
    const range = seasonalGrade({ ...WASHINGTON, from: JUL, to: JAN });
    expect(range.steps).toBeGreaterThan(0);
    expect(range.detail).toMatch(/hardest month in the range/i);
  });

  it("handles a range that wraps the new year", () => {
    // November to February is a real winter trip and must be expressible.
    const g = seasonalGrade({ ...WASHINGTON, from: NOV, to: FEB });
    expect(g.season).toBe("winter");
    expect(g.steps).toBeGreaterThan(0);
  });

  it("treats a single month as a range of one", () => {
    const one = seasonalGrade({ ...WASHINGTON, from: OCT });
    const same = seasonalGrade({ ...WASHINGTON, from: OCT, to: OCT });
    expect(one).toEqual(same);
    expect(one.detail).not.toMatch(/hardest month/i);
  });

  it("defaults to the current month", () => {
    const now = new Date().getMonth();
    expect(seasonalGrade(WASHINGTON)).toEqual(seasonalGrade({ ...WASHINGTON, from: now }));
  });
});

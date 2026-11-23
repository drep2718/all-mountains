import { describe, expect, it } from "vitest";
import { describeTripDistance, isOneWayGeometry, tripFigures } from "@/lib/trip";

const base = {
  routeType: "Out & Back",
  distanceKm: 4.7,
  ascentM: 1736,
  descentM: 0,
  storedMinutes: 460,
  difficulty: "technical" as const,
};

describe("tripFigures", () => {
  it("includes the descent for an out-and-back — the Avalanche Gulch case", () => {
    const t = tripFigures(base);
    expect(t.roundTrip).toBe(true);
    // 4.7 km of line is 9.4 km walked.
    expect(t.distanceKm).toBeCloseTo(9.4, 5);
    // Climbed once, not twice: doubling gain would be wrong, not just odd.
    expect(t.ascentM).toBe(1736);
    // The old figure was 460 min (7h40) for the ascent alone.
    expect(t.minutes).toBeGreaterThan(600);
    expect(t.minutes).toBeLessThan(760);
  });

  it("leaves a loop alone — it already returns to its start", () => {
    const t = tripFigures({ ...base, routeType: "Loop", descentM: 1700 });
    expect(t.roundTrip).toBe(false);
    expect(t.distanceKm).toBeCloseTo(4.7, 5);
  });

  it("does not double a line that already descends", () => {
    // Some mapped lines climb and come back down. That geometry is the
    // whole trip, so doubling it would invent one nobody makes.
    const t = tripFigures({ ...base, descentM: 1700 });
    expect(t.roundTrip).toBe(false);
    expect(t.distanceKm).toBeCloseTo(4.7, 5);
  });

  it("treats a few metres of DEM noise as a monotonic line", () => {
    expect(isOneWayGeometry("Out & Back", 900, 12)).toBe(true);
    expect(isOneWayGeometry("Out & Back", 900, 0)).toBe(true);
    expect(isOneWayGeometry("Out & Back", 900, 400)).toBe(false);
    expect(isOneWayGeometry("Loop", 900, 0)).toBe(false);
  });

  it("does not care which end of the line the surveyor started from", () => {
    // Mount Washington's Nelson Crag Trail is stored running *down* from
    // the summit. Testing descent alone called this undulating and
    // published its 11 m of stored ascent as the mountain's climb.
    expect(isOneWayGeometry("Out & Back", 11, 1114)).toBe(true);
    const t = tripFigures({
      routeType: "Out & Back",
      distanceKm: 4.8,
      ascentM: 11,
      descentM: 1114,
      storedMinutes: null,
      difficulty: "hike",
    });
    expect(t.roundTrip).toBe(true);
    expect(t.ascentM).toBe(1114);
    // 9.6 km and 1,114 m of climb: Naismith gives 189 min once Langmuir
    // credits the gentle descent. Optimistic for Nelson Crag, which is
    // why the UI shows a range — but it is the climb, not the 11 m the
    // stored direction implied.
    expect(t.minutes!).toBeGreaterThan(180);
  });

  it("assumes the usual case when nothing was measured", () => {
    expect(isOneWayGeometry("Out & Back", null, null)).toBe(true);
  });

  it("prefers the live profile over the stored columns", () => {
    const t = tripFigures({
      ...base,
      profile: {
        distanceKm: 5,
        ascentM: 1800,
        descentM: 0,
        minEle: 2561,
        maxEle: 4361,
        maxGrade: 65,
        steepFraction: 0.6,
        samples: [],
      },
    });
    expect(t.distanceKm).toBeCloseTo(10, 5);
    expect(t.ascentM).toBe(1800);
  });

  it("keeps the stored time when there is nothing to measure", () => {
    const t = tripFigures({ ...base, distanceKm: null, ascentM: null });
    expect(t.minutes).toBe(460);
    expect(t.roundTrip).toBe(false);
  });

  it("an easy walk out and back is still longer than one way", () => {
    const oneWay = tripFigures({
      routeType: "Loop",
      distanceKm: 5,
      ascentM: 300,
      descentM: 300,
      storedMinutes: null,
      difficulty: "hike",
    });
    const there = tripFigures({
      routeType: "Out & Back",
      distanceKm: 5,
      ascentM: 300,
      descentM: 0,
      storedMinutes: null,
      difficulty: "hike",
    });
    expect(there.minutes!).toBeGreaterThan(oneWay.minutes!);
  });
});

describe("describeTripDistance", () => {
  it("gives both numbers for an out-and-back, never just one", () => {
    const d = describeTripDistance(tripFigures(base));
    expect(d.primary).toBe("9.4 km round trip");
    expect(d.secondary).toBe("4.7 km each way");
  });

  it("gives one number when there is only one to give", () => {
    const d = describeTripDistance(tripFigures({ ...base, routeType: "Loop", descentM: 1700 }));
    expect(d.primary).toBe("4.7 km");
    expect(d.secondary).toBeNull();
  });

  it("switches to metres below a kilometre, on both halves", () => {
    const d = describeTripDistance(
      tripFigures({ ...base, distanceKm: 0.4, ascentM: 60, descentM: 0 })
    );
    expect(d.primary).toBe("800 m round trip");
    expect(d.secondary).toBe("400 m each way");
  });

  it("says nothing rather than guessing when the distance is unknown", () => {
    const d = describeTripDistance(tripFigures({ ...base, distanceKm: null, ascentM: null }));
    expect(d.primary).toBe("—");
  });
});

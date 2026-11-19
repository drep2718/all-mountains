import { describe, it, expect } from "vitest";
import {
  bearing,
  buildCues,
  compassPoint,
  cumulative,
  guide,
  orientToSummit,
  projectOntoRoute,
  formatDistanceM,
} from "./navigation";
import type { LngLat } from "./polyline";

/** A straight line of `n` points running north from (lng, lat). */
function northLine(lng: number, lat: number, n: number, stepM = 100): LngLat[] {
  const dLat = stepM / 111_320;
  return Array.from({ length: n }, (_, i) => [lng, lat + dLat * i] as LngLat);
}

describe("cumulative", () => {
  it("starts at zero and increases", () => {
    const c = cumulative(northLine(-121, 46, 5));
    expect(c[0]).toBe(0);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
  });

  it("measures roughly the right total", () => {
    const c = cumulative(northLine(-121, 46, 11, 100)); // 10 × 100 m
    expect(c[c.length - 1]).toBeGreaterThan(960);
    expect(c[c.length - 1]).toBeLessThan(1040);
  });
});

describe("projectOntoRoute", () => {
  const line = northLine(-121, 46, 11, 100);

  it("snaps a point on the line to ~zero offset", () => {
    const p = projectOntoRoute([-121, 46 + 450 / 111_320], line)!;
    expect(p.offRouteM).toBeLessThan(1);
    expect(p.alongM).toBeGreaterThan(430);
    expect(p.alongM).toBeLessThan(470);
  });

  it("measures perpendicular offset for a point beside the line", () => {
    // ~70 m east at this latitude
    const east = 70 / (111_320 * Math.cos((46 * Math.PI) / 180));
    const p = projectOntoRoute([-121 + east, 46 + 450 / 111_320], line)!;
    expect(p.offRouteM).toBeGreaterThan(60);
    expect(p.offRouteM).toBeLessThan(80);
  });

  it("clamps to the ends rather than extrapolating", () => {
    const before = projectOntoRoute([-121, 46 - 500 / 111_320], line)!;
    expect(before.alongM).toBe(0);
    const after = projectOntoRoute([-121, 46 + 5000 / 111_320], line)!;
    expect(after.alongM).toBeCloseTo(cumulative(line).at(-1)!, 0);
  });

  it("returns null for a degenerate line", () => {
    expect(projectOntoRoute([-121, 46], [[-121, 46]])).toBeNull();
  });
});

describe("bearing", () => {
  it("reads north, east, south and west", () => {
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0, 0);
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90, 0);
    expect(bearing([0, 1], [0, 0])).toBeCloseTo(180, 0);
    expect(bearing([1, 0], [0, 0])).toBeCloseTo(270, 0);
  });

  it("maps to compass points", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(90)).toBe("E");
    expect(compassPoint(181)).toBe("S");
    expect(compassPoint(359)).toBe("N");
  });
});

describe("orientToSummit", () => {
  it("leaves a line that already ends at the summit alone", () => {
    const line = northLine(-121, 46, 5);
    const summit = line[line.length - 1];
    expect(orientToSummit(line, summit)[0]).toEqual(line[0]);
  });

  it("reverses a line drawn away from the summit", () => {
    const line = northLine(-121, 46, 5);
    const summit = line[0];
    const out = orientToSummit(line, summit);
    expect(out[out.length - 1]).toEqual(summit);
  });
});

describe("buildCues", () => {
  it("announces a right-angle turn once, not per vertex", () => {
    // 1 km north then 1 km east, densely sampled
    const dLat = 100 / 111_320;
    const dLng = 100 / (111_320 * Math.cos((46 * Math.PI) / 180));
    const line: LngLat[] = [];
    for (let i = 0; i < 10; i++) line.push([-121, 46 + dLat * i]);
    for (let i = 1; i <= 10; i++) line.push([-121 + dLng * i, 46 + dLat * 9]);

    const turns = buildCues(line).filter((c) => c.kind === "turn");
    expect(turns).toHaveLength(1);
    expect(turns[0].turn).toBe("right");
  });

  it("ignores a gently wandering path", () => {
    const line: LngLat[] = Array.from({ length: 40 }, (_, i) => [
      -121 + Math.sin(i / 8) * 0.0004,
      46 + i * 0.0009,
    ]);
    expect(buildCues(line).filter((c) => c.kind === "turn")).toHaveLength(0);
  });

  it("always ends with the summit", () => {
    const cues = buildCues(northLine(-121, 46, 10));
    expect(cues[cues.length - 1].kind).toBe("summit");
  });
});

describe("guide", () => {
  const line = northLine(-121, 46, 21, 100); // 2 km
  const summit = line[line.length - 1];

  it("reports progress, remaining distance and ETA", () => {
    const halfway: LngLat = [-121, 46 + 1000 / 111_320];
    const g = guide(halfway, line, summit)!;
    expect(g.progress).toBeGreaterThan(0.45);
    expect(g.progress).toBeLessThan(0.55);
    expect(g.remainingM).toBeGreaterThan(950);
    expect(g.remainingM).toBeLessThan(1050);
    expect(g.etaMinutes).toBeGreaterThan(0);
  });

  it("flags arrival within the summit radius", () => {
    const near: LngLat = [-121, 46 + (2000 - 20) / 111_320];
    expect(guide(near, line, summit)!.atSummit).toBe(true);
    const far: LngLat = [-121, 46 + 1000 / 111_320];
    expect(guide(far, line, summit)!.atSummit).toBe(false);
  });

  it("reports how far off the route you are", () => {
    const east = 120 / (111_320 * Math.cos((46 * Math.PI) / 180));
    const g = guide([-121 + east, 46 + 1000 / 111_320], line, summit)!;
    expect(g.offRouteM).toBeGreaterThan(100);
    expect(g.offRouteM).toBeLessThan(140);
  });

  it("scales the estimate for technical ground", () => {
    const pos: LngLat = [-121, 46];
    const easy = guide(pos, line, summit, { difficulty: "hike" })!;
    const hard = guide(pos, line, summit, { difficulty: "technical" })!;
    expect(hard.etaMinutes).toBeGreaterThan(easy.etaMinutes!);
  });

  it("surfaces the next cue ahead, never one behind", () => {
    const cues = buildCues(line);
    const g = guide([-121, 46 + 1000 / 111_320], line, summit, { cues })!;
    expect(g.nextCue).not.toBeNull();
    expect(g.nextCue!.atM).toBeGreaterThan(g.alongM);
  });
});

describe("formatDistanceM", () => {
  it("rounds metres to ten and switches to km", () => {
    expect(formatDistanceM(123)).toBe("120 m");
    expect(formatDistanceM(1500)).toBe("1.50 km");
    expect(formatDistanceM(23400)).toBe("23.4 km");
  });
});

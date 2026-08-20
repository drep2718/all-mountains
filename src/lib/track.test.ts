import { describe, it, expect } from "vitest";
import {
  haversineM, acceptPoint, computeStats, distanceToTrailM, toLines, toGPX,
  formatPace, formatDuration, MAX_ACCURACY_M, type TrackPoint,
} from "./track";

const pt = (lat: number, lng: number, t: number, ele: number | null = null, acc = 5): TrackPoint =>
  ({ lat, lng, t, ele, acc });

describe("haversineM", () => {
  it("measures a known distance", () => {
    // 1 degree of latitude is ~111.2 km
    expect(haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111195, -2);
  });

  it("is zero for identical points", () => {
    expect(haversineM({ lat: 46.85, lng: -121.76 }, { lat: 46.85, lng: -121.76 })).toBe(0);
  });
});

describe("acceptPoint — GPS noise gates", () => {
  it("rejects a fix that is too inaccurate", () => {
    expect(acceptPoint(null, pt(46, -121, 1000, null, MAX_ACCURACY_M + 1))).toBeNull();
  });

  it("accepts the first good fix with zero distance", () => {
    expect(acceptPoint(null, pt(46, -121, 1000))).toBe(0);
  });

  it("rejects sub-jitter movement so a stationary phone logs no distance", () => {
    const a = pt(46, -121, 1000);
    const b = pt(46.00001, -121, 2000); // ~1.1 m
    expect(acceptPoint(a, b)).toBeNull();
  });

  it("rejects an implausible GPS jump", () => {
    const a = pt(46, -121, 1000);
    const b = pt(46.01, -121, 2000); // ~1.1 km in 1 s
    expect(acceptPoint(a, b)).toBeNull();
  });

  it("rejects out-of-order fixes", () => {
    expect(acceptPoint(pt(46, -121, 5000), pt(46.001, -121, 1000))).toBeNull();
  });

  it("accepts a real walking step", () => {
    const a = pt(46, -121, 1000);
    const b = pt(46.0001, -121, 6000); // ~11 m over 5 s
    const d = acceptPoint(a, b);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(10);
  });
});

describe("computeStats", () => {
  it("is all-zero for an empty track", () => {
    const s = computeStats([]);
    expect(s.distanceKm).toBe(0);
    expect(s.ascentM).toBe(0);
    expect(s.avgPaceMinPerKm).toBeNull();
  });

  it("accumulates distance along a track", () => {
    const s = computeStats([
      pt(46, -121, 0), pt(46.001, -121, 60000), pt(46.002, -121, 120000),
    ]);
    expect(s.distanceKm).toBeGreaterThan(0.2);
    expect(s.distanceKm).toBeLessThan(0.25);
  });

  it("ignores elevation noise below the threshold", () => {
    // Wobbles of ±1 m must not accumulate as climbing.
    const s = computeStats([
      pt(46, -121, 0, 1000), pt(46.001, -121, 60000, 1001),
      pt(46.002, -121, 120000, 1000), pt(46.003, -121, 180000, 1001),
    ]);
    expect(s.ascentM).toBe(0);
    expect(s.descentM).toBe(0);
  });

  it("counts a real climb", () => {
    const s = computeStats([
      pt(46, -121, 0, 1000), pt(46.001, -121, 60000, 1010), pt(46.002, -121, 120000, 1020),
    ]);
    expect(s.ascentM).toBeCloseTo(20, 0);
    expect(s.descentM).toBe(0);
  });

  it("counts descent separately", () => {
    const s = computeStats([
      pt(46, -121, 0, 1000), pt(46.001, -121, 60000, 980),
    ]);
    expect(s.descentM).toBeCloseTo(20, 0);
    expect(s.ascentM).toBe(0);
  });

  it("excludes paused time from elapsed", () => {
    const s = computeStats([pt(46, -121, 0), pt(46.001, -121, 120000)], 60000);
    expect(s.elapsedSeconds).toBeCloseTo(60, 0);
  });

  it("does not count stationary time as moving time", () => {
    // Two fixes 10 minutes apart but barely any movement.
    const s = computeStats([pt(46, -121, 0), pt(46.00002, -121, 600000)]);
    expect(s.movingSeconds).toBe(0);
  });
});

describe("distanceToTrailM", () => {
  const line: number[][][] = [[[-121, 46], [-121, 46.01]]]; // due-north segment

  it("is ~0 when standing on the trail", () => {
    expect(distanceToTrailM({ lat: 46.005, lng: -121 }, line)).toBeLessThan(1);
  });

  it("measures perpendicular offset from the trail", () => {
    // 0.001 deg of longitude at lat 46 is ~77 m
    const d = distanceToTrailM({ lat: 46.005, lng: -121.001 }, line);
    expect(d).toBeGreaterThan(60);
    expect(d).toBeLessThan(90);
  });

  it("clamps to the segment ends rather than the infinite line", () => {
    const d = distanceToTrailM({ lat: 45.99, lng: -121 }, line);
    expect(d).toBeGreaterThan(1000);
  });

  it("returns Infinity with no geometry", () => {
    expect(distanceToTrailM({ lat: 46, lng: -121 }, [])).toBe(Infinity);
  });
});

describe("toLines", () => {
  it("normalizes LineString", () => {
    expect(toLines({ type: "LineString", coordinates: [[0, 0], [1, 1]] })).toHaveLength(1);
  });
  it("normalizes MultiLineString", () => {
    expect(toLines({ type: "MultiLineString", coordinates: [[[0, 0]], [[1, 1]]] })).toHaveLength(2);
  });
  it("survives garbage", () => {
    expect(toLines(null)).toEqual([]);
    expect(toLines({ type: "Point", coordinates: [0, 0] })).toEqual([]);
  });
});

describe("formatPace", () => {
  it("formats a normal pace", () => {
    expect(formatPace(8.5)).toBe("8:30 /km");
  });

  it("never renders 60 seconds — rolls into the next minute", () => {
    // 8.986 min/km rounds to 59.2→60 s naively, which would read "8:60".
    expect(formatPace(8.9986)).toBe("9:00 /km");
    expect(formatPace(11.999)).toBe("12:00 /km");
  });

  it("pads single-digit seconds", () => {
    expect(formatPace(10.05)).toBe("10:03 /km");
  });

  it("handles no data", () => {
    expect(formatPace(null)).toBe("—");
    expect(formatPace(Infinity)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("shows m:ss under an hour and h:mm:ss over", () => {
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(3661)).toBe("1:01:01");
  });

  it("clamps negatives to zero", () => {
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("toGPX", () => {
  it("emits valid-looking GPX with track points", () => {
    const gpx = toGPX("Test Hike", [pt(46, -121, 0, 1000), pt(46.001, -121, 60000, 1010)]);
    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain("<trkpt");
    expect(gpx).toContain("<ele>1000.0</ele>");
    expect((gpx.match(/<trkpt/g) || []).length).toBe(2);
  });

  it("escapes names so a quote cannot break the XML", () => {
    expect(toGPX('Bob & "Al" <x>', [pt(46, -121, 0)])).toContain("Bob &amp; &quot;Al&quot; &lt;x&gt;");
  });
});

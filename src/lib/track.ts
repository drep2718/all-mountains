// Geo math for GPS track recording. Pure functions, no React, no browser APIs —
// so the safety-critical parts (distance, elevation, off-route) are testable.

import { decodeSegments } from "./polyline";

export interface TrackPoint {
  lat: number;
  lng: number;
  ele: number | null;   // metres
  t: number;            // epoch ms
  acc: number | null;   // horizontal accuracy, metres
}

export interface TrackStats {
  distanceKm: number;
  movingSeconds: number;
  elapsedSeconds: number;
  ascentM: number;
  descentM: number;
  currentSpeedKmh: number;
  avgPaceMinPerKm: number | null;
  lastEle: number | null;
}

// --- Tuning constants -------------------------------------------------------
// A consumer GPS fix wanders even when you stand still. Without these gates a
// stationary phone accumulates kilometres of phantom distance.

/** Discard fixes less accurate than this (metres). */
export const MAX_ACCURACY_M = 50;
/** Movement below this between fixes is treated as jitter, not travel (metres). */
export const MIN_STEP_M = 4;
/** Faster than this between two fixes means a GPS jump, not a hiker (m/s). */
export const MAX_SPEED_MS = 15;
/** Elevation must change by at least this before it counts, to damp GPS noise (metres). */
export const ELE_THRESHOLD_M = 3;
/** Below this speed the hiker is considered stopped, for moving-time (m/s). */
export const MOVING_MIN_MS = 0.3;
/** Warn when this far from the trail line (metres). */
export const OFF_ROUTE_M = 60;

const R = 6371000; // earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const la1 = rad(a.lat);
  const la2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Decide whether a new fix should be appended to the track.
 * Returns the accepted step distance in metres, or null to reject the fix.
 */
export function acceptPoint(prev: TrackPoint | null, next: TrackPoint): number | null {
  if (next.acc != null && next.acc > MAX_ACCURACY_M) return null; // too fuzzy to trust
  if (!prev) return 0;

  const d = haversineM(prev, next);
  const dt = (next.t - prev.t) / 1000;
  if (dt <= 0) return null;                    // out-of-order / duplicate fix
  if (d / dt > MAX_SPEED_MS) return null;      // teleport — bad fix
  if (d < MIN_STEP_M) return null;             // standing still, jittering
  return d;
}

/**
 * Recompute stats over a whole track. Cheap enough to run per fix (tracks are
 * thousands of points at most) and avoids drift from incremental bookkeeping.
 */
export function computeStats(points: TrackPoint[], pausedMs = 0): TrackStats {
  let distanceM = 0;
  let movingMs = 0;
  let ascent = 0;
  let descent = 0;
  // Seed from the first point, or the climb between point 0 and point 1 is lost.
  let refEle: number | null = points[0]?.ele ?? null;
  let currentSpeedKmh = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = haversineM(a, b);
    const dt = (b.t - a.t) / 1000;
    distanceM += d;
    if (dt > 0) {
      const speed = d / dt;
      if (speed >= MOVING_MIN_MS) movingMs += dt * 1000;
      if (i === points.length - 1) currentSpeedKmh = speed * 3.6;
    }

    // Elevation: only bank a change once it clears the noise threshold, so a
    // flat walk doesn't accumulate hundreds of phantom metres.
    if (b.ele != null) {
      if (refEle == null) refEle = b.ele;
      const diff = b.ele - refEle;
      if (diff >= ELE_THRESHOLD_M) {
        ascent += diff;
        refEle = b.ele;
      } else if (diff <= -ELE_THRESHOLD_M) {
        descent += -diff;
        refEle = b.ele;
      }
    }
  }

  const first = points[0];
  const last = points[points.length - 1];
  const elapsedSeconds =
    first && last ? Math.max(0, (last.t - first.t - pausedMs) / 1000) : 0;
  const distanceKm = distanceM / 1000;
  const movingSeconds = movingMs / 1000;

  return {
    distanceKm,
    movingSeconds,
    elapsedSeconds,
    ascentM: ascent,
    descentM: descent,
    currentSpeedKmh,
    avgPaceMinPerKm:
      distanceKm > 0.01 && movingSeconds > 0 ? movingSeconds / 60 / distanceKm : null,
    lastEle: last?.ele ?? null,
  };
}

// --- Off-route detection ----------------------------------------------------

/** Perpendicular distance (metres) from point p to segment a→b. */
function distToSegmentM(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  // Project into a local metres plane — accurate enough over segment lengths.
  const latRef = rad(p.lat);
  const mx = (deg: number) => deg * 111320 * Math.cos(latRef);
  const my = (deg: number) => deg * 110540;

  const px = mx(p.lng), py = my(p.lat);
  const ax = mx(a.lng), ay = my(a.lat);
  const bx = mx(b.lng), by = my(b.lat);

  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Shortest distance in metres from a position to a trail polyline.
 * `lines` are [lng,lat] coordinate arrays (GeoJSON order).
 */
export function distanceToTrailM(
  p: { lat: number; lng: number },
  lines: number[][][]
): number {
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = { lng: line[i - 1][0], lat: line[i - 1][1] };
      const b = { lng: line[i][0], lat: line[i][1] };
      const d = distToSegmentM(p, a, b);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Normalize stored trail geometry to a list of [lng,lat] lines.
 *
 * Accepts the encoded-polyline string trails are stored as, and still accepts
 * raw GeoJSON so a recorded track or an imported GPX can be passed straight in.
 */
export function toLines(geometry: unknown): number[][][] {
  if (typeof geometry === "string") return decodeSegments(geometry);
  const g = geometry as { type?: string; coordinates?: unknown };
  if (!g?.type || !g.coordinates) return [];
  if (g.type === "LineString") return [g.coordinates as number[][]];
  if (g.type === "MultiLineString") return g.coordinates as number[][][];
  return [];
}

// --- Formatting -------------------------------------------------------------

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatPace(minPerKm: number | null): string {
  if (minPerKm == null || !isFinite(minPerKm)) return "—";
  let m = Math.floor(minPerKm);
  let s = Math.round((minPerKm - m) * 60);
  // Rounding 59.6s up yields 60 — roll it into the next minute rather than
  // rendering an impossible "8:60".
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

// --- GPX --------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Serialize a track to GPX 1.1. */
export function toGPX(name: string, points: TrackPoint[]): string {
  const pts = points
    .map((p) => {
      const ele = p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : "";
      return `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${ele}<time>${new Date(p.t).toISOString()}</time></trkpt>`;
    })
    .join("\n      ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="All Mountains" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata><name>${esc(name)}</name><time>${new Date(points[0]?.t ?? Date.now()).toISOString()}</time></metadata>
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
      ${pts}
    </trkseg>
  </trk>
</gpx>`;
}

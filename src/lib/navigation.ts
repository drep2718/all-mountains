/**
 * Guidance along a known summit path.
 *
 * This is not turn-by-turn in the driving sense — there is no routing engine
 * and no junction graph for a mountain trail, and pretending otherwise would
 * invent instructions. What it does is honest and, on a mountain, more useful:
 * where you are along the path, how far and how much climbing is left, what
 * the terrain does next, and whether you have wandered off it.
 */

import type { LngLat } from "@/lib/polyline";
import { haversineM, type ElevationSample, type RouteProfile } from "@/lib/terrain";

export interface Projection {
  /** Index of the segment start the position projects onto. */
  index: number;
  /** Metres from the route at the closest point. */
  offRouteM: number;
  /** Metres travelled along the route to that closest point. */
  alongM: number;
  /** The closest point itself. */
  snapped: LngLat;
}

/** Distance from point p to segment ab, in metres, plus where it lands. */
function pointToSegment(
  p: LngLat,
  a: LngLat,
  b: LngLat
): { dist: number; t: number; point: LngLat } {
  // Work in a local planar frame; over a segment of a few hundred metres the
  // error is far below GPS noise.
  const latRad = (a[1] * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(latRad);

  const ax = 0;
  const ay = 0;
  const bx = (b[0] - a[0]) * mPerDegLng;
  const by = (b[1] - a[1]) * mPerDegLat;
  const px = (p[0] - a[0]) * mPerDegLng;
  const py = (p[1] - a[1]) * mPerDegLat;

  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / len2));
  const cx = ax + bx * t;
  const cy = ay + by * t;
  const dist = Math.hypot(px - cx, py - cy);

  return {
    dist,
    t,
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  };
}

/** Cumulative distance to each vertex, metres. */
export function cumulative(line: LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) {
    out.push(out[i - 1] + haversineM(line[i - 1][1], line[i - 1][0], line[i][1], line[i][0]));
  }
  return out;
}

/** Where the walker is on the path. */
export function projectOntoRoute(pos: LngLat, line: LngLat[], cum?: number[]): Projection | null {
  if (line.length < 2) return null;
  const c = cum ?? cumulative(line);

  let best: Projection | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const r = pointToSegment(pos, line[i], line[i + 1]);
    if (!best || r.dist < best.offRouteM) {
      best = {
        index: i,
        offRouteM: r.dist,
        alongM: c[i] + (c[i + 1] - c[i]) * r.t,
        snapped: r.point,
      };
    }
  }
  return best;
}

/** Compass bearing from a to b, degrees from north. */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = (a[1] * Math.PI) / 180;
  const φ2 = (b[1] * Math.PI) / 180;
  const Δλ = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

export const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export const compassPoint = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

// --- cues -----------------------------------------------------------------

export type CueKind = "turn" | "steep" | "summit" | "start";

export interface Cue {
  /** Distance along the route at which it applies, metres. */
  atM: number;
  kind: CueKind;
  text: string;
  /** Turn direction, where it is one. */
  turn?: "left" | "right";
  /** Bearing change in degrees, for turns. */
  deltaDeg?: number;
}

/** Below this a bend is just the trail wandering, not a turn worth announcing. */
const TURN_THRESHOLD_DEG = 45;
/** Look this far either side of a vertex to judge the bend, metres. */
const TURN_SPAN_M = 60;

/**
 * Derive cues from the path's own geometry and the terrain under it.
 *
 * Only two kinds are real without a junction graph: the path changes direction
 * sharply, and the ground gets markedly steeper. Both are things you can see
 * on the map and feel underfoot, so neither invents knowledge we do not have.
 */
export function buildCues(line: LngLat[], profile?: RouteProfile | null): Cue[] {
  if (line.length < 3) return [];
  const c = cumulative(line);
  const total = c[c.length - 1];
  const cues: Cue[] = [];

  // --- direction changes ---
  for (let i = 1; i < line.length - 1; i++) {
    // Compare headings over a span, not between adjacent vertices: OSM
    // vertices are dense on bends, so adjacent-pair headings swing wildly and
    // would announce a turn every few metres.
    let back = i;
    while (back > 0 && c[i] - c[back] < TURN_SPAN_M) back--;
    let fwd = i;
    while (fwd < line.length - 1 && c[fwd] - c[i] < TURN_SPAN_M) fwd++;
    if (back === i || fwd === i) continue;

    const inBearing = bearing(line[back], line[i]);
    const outBearing = bearing(line[i], line[fwd]);
    let delta = outBearing - inBearing;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;

    if (Math.abs(delta) < TURN_THRESHOLD_DEG) continue;

    // Don't stack cues on one bend.
    const last = cues[cues.length - 1];
    if (last && last.kind === "turn" && c[i] - last.atM < TURN_SPAN_M * 2) continue;

    const dir = delta > 0 ? "right" : "left";
    const sharp = Math.abs(delta) >= 100;
    cues.push({
      atM: c[i],
      kind: "turn",
      turn: dir,
      deltaDeg: Math.round(delta),
      text: sharp ? `Sharp ${dir}` : `Bear ${dir}`,
    });
  }

  // --- where it gets steep ---
  if (profile?.samples.length) {
    const s = profile.samples;
    let inSteep = false;
    for (let i = 1; i < s.length; i++) {
      const steep = s[i].grade >= 25;
      if (steep && !inSteep) {
        inSteep = true;
        // Only call it out if it lasts; a single steep step is a boulder.
        const run = runLength(s, i, 25);
        if (run >= 80) {
          cues.push({
            atM: s[i].km * 1000,
            kind: "steep",
            text: `Steep climb begins — ${Math.round(averageGrade(s, i, run))}% for ${Math.round(run)} m`,
          });
        }
      } else if (!steep) {
        inSteep = false;
      }
    }
  }

  cues.push({ atM: total, kind: "summit", text: "Summit" });
  return cues.sort((a, b) => a.atM - b.atM);
}

function runLength(s: ElevationSample[], from: number, minGrade: number): number {
  let i = from;
  while (i < s.length && s[i].grade >= minGrade) i++;
  return (s[Math.min(i, s.length - 1)].km - s[from].km) * 1000;
}

function averageGrade(s: ElevationSample[], from: number, runM: number): number {
  const endKm = s[from].km + runM / 1000;
  const slice = s.filter((x) => x.km >= s[from].km && x.km <= endKm);
  if (!slice.length) return s[from].grade;
  return slice.reduce((a, x) => a + x.grade, 0) / slice.length;
}

// --- live guidance --------------------------------------------------------

export interface Guidance {
  /** 0–1 along the route. */
  progress: number;
  alongM: number;
  remainingM: number;
  offRouteM: number;
  /** Climb still to come, from the profile. */
  remainingAscentM: number | null;
  /** Minutes left, from remaining distance and climb. */
  etaMinutes: number | null;
  /** Straight-line distance to the summit. */
  toSummitM: number;
  bearingToSummit: number;
  /** The next cue ahead, and how far to it. */
  nextCue: (Cue & { inM: number }) | null;
  /** True once within SUMMIT_RADIUS_M of the top. */
  atSummit: boolean;
}

/** Close enough to the top to call it climbed. */
export const SUMMIT_RADIUS_M = 50;

export function guide(
  pos: LngLat,
  line: LngLat[],
  summit: LngLat,
  opts: {
    cum?: number[];
    cues?: Cue[];
    profile?: RouteProfile | null;
    difficulty?: "hike" | "scramble" | "technical";
  } = {}
): Guidance | null {
  const cum = opts.cum ?? cumulative(line);
  const proj = projectOntoRoute(pos, line, cum);
  if (!proj) return null;

  const total = cum[cum.length - 1];
  const remainingM = Math.max(0, total - proj.alongM);
  const toSummitM = haversineM(pos[1], pos[0], summit[1], summit[0]);

  let remainingAscentM: number | null = null;
  if (opts.profile?.samples.length) {
    const s = opts.profile.samples;
    const fromKm = proj.alongM / 1000;
    let asc = 0;
    let ref: number | null = null;
    for (const sample of s) {
      if (sample.km < fromKm) continue;
      if (ref == null) ref = sample.ele;
      else if (sample.ele - ref >= 2) {
        asc += sample.ele - ref;
        ref = sample.ele;
      } else if (sample.ele < ref) ref = sample.ele;
    }
    remainingAscentM = Math.round(asc);
  }

  const factor =
    opts.difficulty === "technical" ? 2.0 : opts.difficulty === "scramble" ? 1.4 : 1;
  const etaMinutes =
    remainingM > 0
      ? Math.round(((remainingM / 1000) * 12 + ((remainingAscentM ?? 0) / 100) * 10) * factor)
      : 0;

  let nextCue: (Cue & { inM: number }) | null = null;
  for (const cue of opts.cues ?? []) {
    // 15 m of slack so a cue doesn't re-fire while you stand on it.
    if (cue.atM > proj.alongM + 15) {
      nextCue = { ...cue, inM: cue.atM - proj.alongM };
      break;
    }
  }

  return {
    progress: total > 0 ? Math.min(1, proj.alongM / total) : 0,
    alongM: proj.alongM,
    remainingM,
    offRouteM: proj.offRouteM,
    remainingAscentM,
    etaMinutes,
    toSummitM,
    bearingToSummit: bearing(pos, summit),
    nextCue,
    atSummit: toSummitM <= SUMMIT_RADIUS_M,
  };
}

/**
 * Orient the path so "forward" means "towards the summit".
 *
 * A trail is stored in whatever direction OSM drew it, which is as likely to
 * start at the top as the bottom. Without this, progress would count down and
 * every cue would be in the wrong order.
 */
export function orientToSummit(line: LngLat[], summit: LngLat): LngLat[] {
  if (line.length < 2) return line;
  const first = line[0];
  const last = line[line.length - 1];
  const dFirst = haversineM(first[1], first[0], summit[1], summit[0]);
  const dLast = haversineM(last[1], last[0], summit[1], summit[0]);
  return dLast <= dFirst ? line : [...line].reverse();
}

export function formatDistanceM(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

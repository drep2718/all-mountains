/**
 * Terrain sampling and route analysis.
 *
 * OSM way geometry carries no elevation, so a trail's ascent, grade and
 * profile cannot come from the import. Mapbox's terrain DEM is already loaded
 * to render the 3-D view, and `queryTerrainElevation` reads it on the client —
 * so the numbers come from the same surface you are looking at, for free, with
 * no extra API and no extra storage.
 */

import type mapboxgl from "mapbox-gl";
import type { LngLat } from "@/lib/polyline";

export interface ElevationSample {
  /** Cumulative distance from the start, km. */
  km: number;
  /** Metres above sea level. */
  ele: number;
  lng: number;
  lat: number;
  /** Grade over the preceding segment, as a percentage. */
  grade: number;
}

export interface RouteProfile {
  samples: ElevationSample[];
  distanceKm: number;
  ascentM: number;
  descentM: number;
  minEle: number;
  maxEle: number;
  /** Steepest sustained grade over ~100 m, percent. */
  maxGrade: number;
  /** Share of the route steeper than 25%. */
  steepFraction: number;
}

const R = 6_371_000;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Resample a polyline to roughly even spacing.
 *
 * OSM vertices cluster on bends and thin out on straights, so profiling them
 * directly over-weights the twisty parts. Even spacing makes grade and
 * distance-along-route mean what they look like.
 */
export function resample(line: LngLat[], stepM = 25, maxPoints = 400): LngLat[] {
  if (line.length < 2) return line;

  let total = 0;
  const segLen: number[] = [];
  for (let i = 1; i < line.length; i++) {
    const d = haversineM(line[i - 1][1], line[i - 1][0], line[i][1], line[i][0]);
    segLen.push(d);
    total += d;
  }
  if (total === 0) return [line[0]];

  const step = Math.max(stepM, total / maxPoints);
  const out: LngLat[] = [line[0]];
  let target = step;
  let walked = 0;

  for (let i = 0; i < segLen.length; i++) {
    const segStart = walked;
    const segEnd = walked + segLen[i];
    while (target <= segEnd && segLen[i] > 0) {
      const t = (target - segStart) / segLen[i];
      out.push([
        line[i][0] + (line[i + 1][0] - line[i][0]) * t,
        line[i][1] + (line[i + 1][1] - line[i][1]) * t,
      ]);
      target += step;
    }
    walked = segEnd;
  }
  const last = line[line.length - 1];
  if (out[out.length - 1][0] !== last[0] || out[out.length - 1][1] !== last[1]) out.push(last);
  return out;
}

/**
 * Light smoothing before measuring ascent.
 *
 * A DEM is a sampled surface: consecutive reads wobble by a metre or two even
 * on flat ground. Summed raw over 400 points that noise alone invents a couple
 * of hundred metres of climb, which is how elevation gain figures end up
 * absurd. A 5-point median kills the spikes without flattening real terrain.
 */
function denoise(values: number[]): number[] {
  if (values.length < 5) return values;
  const out = values.slice();
  for (let i = 2; i < values.length - 2; i++) {
    const w = [values[i - 2], values[i - 1], values[i], values[i + 1], values[i + 2]].sort(
      (a, b) => a - b
    );
    out[i] = w[2];
  }
  return out;
}

/** Ignore rises below this; they are DEM noise, not climbing. */
const ASCENT_THRESHOLD_M = 2;

/**
 * Build a profile for one route by reading the terrain under it.
 * Returns null while the DEM for this area has not loaded.
 */
/**
 * Sampling step.
 *
 * Mapbox's terrain DEM is roughly 30 m per pixel at its deepest zoom, so
 * sampling finer than that reads the same cell twice in some places and
 * straddles a cliff in others. At a 25 m step Whitney's Mountaineer's Route
 * reported a 130% sustained grade — a 52° slope — which is the artifact, not
 * the couloir.
 */
const DEM_RESOLUTION_M = 30;
/** "Steepest" means sustained over this distance, not one lucky pair of pixels. */
const GRADE_WINDOW_M = 200;

export function profileFromTerrain(
  map: mapboxgl.Map,
  line: LngLat[],
  { stepM = DEM_RESOLUTION_M, maxPoints = 400 } = {}
): RouteProfile | null {
  const pts = resample(line, stepM, maxPoints);
  if (pts.length < 2) return null;

  const raw: number[] = [];
  for (const [lng, lat] of pts) {
    const e = map.queryTerrainElevation({ lng, lat }, { exaggerated: false });
    if (e == null) return null; // tile not loaded yet — caller retries
    raw.push(e);
  }
  const ele = denoise(raw);

  const samples: ElevationSample[] = [];
  let cumM = 0;
  let ascent = 0;
  let descent = 0;
  let reference = ele[0];

  for (let i = 0; i < pts.length; i++) {
    let grade = 0;
    if (i > 0) {
      const d = haversineM(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
      cumM += d;
      if (d > 0.5) grade = ((ele[i] - ele[i - 1]) / d) * 100;

      // Threshold against the last committed level, not the previous point,
      // so a long gentle climb still counts while jitter does not.
      const delta = ele[i] - reference;
      if (delta >= ASCENT_THRESHOLD_M) {
        ascent += delta;
        reference = ele[i];
      } else if (delta <= -ASCENT_THRESHOLD_M) {
        descent += -delta;
        reference = ele[i];
      }
    }
    samples.push({
      km: cumM / 1000,
      ele: ele[i],
      lng: pts[i][0],
      lat: pts[i][1],
      grade,
    });
  }

  // Steepest sustained grade, measured over GRADE_WINDOW_M so a single pair of
  // DEM pixels across a cliff edge cannot define it.
  const window = Math.max(2, Math.round(GRADE_WINDOW_M / stepM));
  let maxGrade = 0;
  for (let i = window; i < samples.length; i++) {
    const dz = samples[i].ele - samples[i - window].ele;
    const dx = (samples[i].km - samples[i - window].km) * 1000;
    if (dx > 1) maxGrade = Math.max(maxGrade, Math.abs((dz / dx) * 100));
  }

  const steep = samples.filter((s) => Math.abs(s.grade) > 25).length;

  return {
    samples,
    distanceKm: cumM / 1000,
    ascentM: Math.round(ascent),
    descentM: Math.round(descent),
    minEle: Math.round(Math.min(...ele)),
    maxEle: Math.round(Math.max(...ele)),
    maxGrade: Math.round(maxGrade),
    steepFraction: samples.length ? steep / samples.length : 0,
  };
}

// --- time -----------------------------------------------------------------

/**
 * Naismith with Langmuir's descent correction.
 *
 * Naismith alone (12 min/km + 10 min per 100 m up) is optimistic on anything
 * rough, and says nothing about coming down. Langmuir adds time back for steep
 * descent, where you slow down rather than speed up.
 */
export function estimateMinutes(
  distanceKm: number,
  ascentM: number,
  descentM: number,
  difficulty: "hike" | "scramble" | "technical" = "hike"
): number {
  let minutes = distanceKm * 12 + (ascentM / 100) * 10;
  // Langmuir: descent on a gentle grade is slightly faster, steep is slower.
  const descentGrade = distanceKm > 0 ? descentM / (distanceKm * 1000) : 0;
  if (descentGrade > 0.12) minutes += (descentM / 300) * 10;
  else minutes -= (descentM / 300) * 10;

  // Scrambling and climbing are not walking.
  const factor = difficulty === "technical" ? 2.0 : difficulty === "scramble" ? 1.4 : 1;
  return Math.max(5, Math.round(minutes * factor));
}

// --- hazards --------------------------------------------------------------

export type HazardLevel = "info" | "caution" | "serious";

export interface Hazard {
  level: HazardLevel;
  title: string;
  detail: string;
}

export interface HazardInput {
  summitElevationM: number;
  difficulty: "hike" | "scramble" | "technical";
  profile?: RouteProfile | null;
  distanceKm?: number | null;
  /** Latitude, for the snow-season estimate. */
  latitude: number;
  /** Current month, 0-11. Defaults to now. */
  month?: number;
  /** From the live forecast, when it is available. */
  weather?: { tempC: number; windKph: number; code: number } | null;
}

/**
 * Hazards derived from facts we actually hold, never invented.
 *
 * Each one names the number it came from, so a climber can judge it instead of
 * trusting a label. This is advisory and says so — it is not a substitute for
 * a forecast, a guidebook or local knowledge.
 */
export function assessHazards(input: HazardInput): Hazard[] {
  const out: Hazard[] = [];
  const { summitElevationM: ele, difficulty, profile, latitude, weather } = input;
  const month = input.month ?? new Date().getMonth();

  // --- altitude ---
  if (ele >= 5000) {
    out.push({
      level: "serious",
      title: "Extreme altitude",
      detail: `The summit is at ${ele.toLocaleString()} m. Above 5,000 m acclimatisation is mandatory and pulmonary or cerebral oedema is a real risk.`,
    });
  } else if (ele >= 3500) {
    out.push({
      level: "caution",
      title: "High altitude",
      detail: `${ele.toLocaleString()} m. Altitude sickness is common above 3,500 m — ascend gradually and turn back if symptoms start.`,
    });
  } else if (ele >= 2500) {
    out.push({
      level: "info",
      title: "Moderate altitude",
      detail: `${ele.toLocaleString()} m. Mild altitude effects are possible if you have come from sea level the same day.`,
    });
  }

  // --- terrain ---
  if (difficulty === "technical") {
    out.push({
      level: "serious",
      title: "Technical climbing",
      detail:
        "Graded technical: rope, hardware and the skill to use them are expected. There is no walking route to this summit.",
    });
  } else if (difficulty === "scramble") {
    out.push({
      level: "caution",
      title: "Scrambling",
      detail: "Hands needed in places, with exposure. A slip in the wrong spot has consequences.",
    });
  }

  if (profile) {
    if (profile.maxGrade >= 45) {
      out.push({
        level: "serious",
        title: `Very steep ground — ${profile.maxGrade}%`,
        detail: `The steepest sustained stretch averages ${profile.maxGrade}% over 200 m. Expect loose rock and hard going underfoot.`,
      });
    } else if (profile.maxGrade >= 30) {
      out.push({
        level: "caution",
        title: `Steep sections — ${profile.maxGrade}%`,
        detail: `The steepest 200 m averages ${profile.maxGrade}%, and ${Math.round(profile.steepFraction * 100)}% of the route exceeds 25%.`,
      });
    }

    if (profile.ascentM >= 1500) {
      out.push({
        level: "caution",
        title: `Big day — ${profile.ascentM.toLocaleString()} m of ascent`,
        detail: `Measured from the terrain model. Sustained climbing of this size needs food, water and daylight planned for.`,
      });
    }
  }

  // --- season ---
  // Northern winter runs Nov–Apr, southern May–Oct.
  const northern = latitude >= 0;
  const winter = northern ? month >= 10 || month <= 3 : month >= 4 && month <= 9;
  const shoulder = northern ? month === 4 || month === 9 : month === 10 || month === 3;
  const snowLine = Math.abs(latitude) > 60 ? 600 : Math.abs(latitude) > 45 ? 1500 : 2500;

  if (winter && ele >= snowLine) {
    out.push({
      level: "serious",
      title: "Winter conditions likely",
      detail: `At ${ele.toLocaleString()} m and this latitude the route is probably under snow and ice right now. Axe, crampons and avalanche awareness.`,
    });
  } else if (shoulder && ele >= snowLine) {
    out.push({
      level: "caution",
      title: "Snow may linger",
      detail: `Shoulder season. Old snow often holds in gullies and on north-facing ground above about ${snowLine.toLocaleString()} m.`,
    });
  }

  // --- live weather ---
  if (weather) {
    if (weather.windKph >= 60) {
      out.push({
        level: "serious",
        title: `Wind ${Math.round(weather.windKph)} km/h at the summit`,
        detail: "Hard to stand up in, and far worse on a ridge or an exposed traverse.",
      });
    } else if (weather.windKph >= 35) {
      out.push({
        level: "caution",
        title: `Windy — ${Math.round(weather.windKph)} km/h`,
        detail: "Enough to unbalance you on exposed ground and to strip heat fast.",
      });
    }
    if (weather.tempC <= -10) {
      out.push({
        level: "serious",
        title: `${Math.round(weather.tempC)}°C at the summit`,
        detail: "Frostbite weather before windchill. Cover everything.",
      });
    } else if (weather.tempC <= 0) {
      out.push({
        level: "caution",
        title: `Freezing — ${Math.round(weather.tempC)}°C`,
        detail: "Ice underfoot, especially early and on shaded ground.",
      });
    }
    // WMO: 95+ thunderstorm, 71-77 snow, 65/82 heavy rain
    if (weather.code >= 95) {
      out.push({
        level: "serious",
        title: "Thunderstorms forecast",
        detail: "A summit is the worst place to be in a storm. Be down before it arrives.",
      });
    } else if (weather.code >= 71 && weather.code <= 77) {
      out.push({
        level: "caution",
        title: "Snow falling",
        detail: "Navigation gets hard fast once tracks fill in.",
      });
    }
  }

  const rank: Record<HazardLevel, number> = { serious: 0, caution: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

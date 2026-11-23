import type { PeakDifficulty } from "@/lib/peak-types";

/**
 * What a month does to a mountain.
 *
 * A grade in the catalogue is the grade in good conditions. Mount
 * Washington is a walk-up in July and a full winter mountaineering
 * objective in February — same path, same 1,917 m, and the difference has
 * killed more people there than the terrain ever has. Showing one grade
 * all year is the kind of accuracy problem that matters.
 *
 * Two corrections to the season model that was previously buried inside
 * `assessHazards`, both of which it got wrong:
 *
 *  1. The snow line was bucketed — 600 m above 60°, 1,500 m above 45°,
 *     2,500 m otherwise. Mount Washington sits at 44.27°, so it fell into
 *     the 2,500 m bucket, its 1,917 m summit counted as below the snow
 *     line, and it drew no winter warning whatsoever. The very example
 *     anyone would reach for. It is now a continuous function of latitude.
 *
 *  2. Every latitude got a winter. At the equator the code still picked a
 *     hemisphere and called six months winter, which is not how tropical
 *     mountains work: Kilimanjaro has wet and dry seasons, and its summit
 *     is near freezing in every one of them.
 *
 * The model is deliberately coarse. It knows latitude, elevation and the
 * month; it does not know aspect, this year's snowpack, or whether the
 * approach road is gated. It raises grades and never lowers them below
 * the catalogue's, because the catalogue grade already describes the best
 * conditions of the year — there is no month that makes a mountain easier
 * than its own best day.
 */

/** Degrees from the equator within which there is no winter, only wet and dry. */
const TROPICS_DEG = 23.5;

/** A grade harder, capped — nothing is harder than technical. */
const HARDER: Record<PeakDifficulty, PeakDifficulty> = {
  hike: "scramble",
  scramble: "technical",
  technical: "technical",
};

const escalate = (d: PeakDifficulty, steps: number): PeakDifficulty => {
  let out = d;
  for (let i = 0; i < steps; i++) out = HARDER[out];
  return out;
};

/**
 * Roughly the height at which snow lies through the winter, by latitude.
 *
 * Continuous rather than bucketed, which is the fix for the Mount
 * Washington case above. Anchored on the usual figures — about 4,800 m at
 * the equator, 1,700 m in the northern Appalachians and Alps foothills,
 * 600 m in south-central Alaska, sea level past about 68°.
 */
export function winterSnowLineM(latitude: number): number {
  return Math.max(0, Math.round(4800 - 70 * Math.abs(latitude)));
}

export type Season = "winter" | "shoulder" | "summer" | "tropical";

/** Which season a month falls in at this latitude. Month is 0-11. */
export function seasonFor(latitude: number, month: number): Season {
  if (Math.abs(latitude) < TROPICS_DEG) return "tropical";
  const northern = latitude >= 0;
  // Northern winter Nov–Mar, shoulder Apr and Oct; southern inverted.
  const n = (m: number) => (northern ? m : (m + 6) % 12);
  const m = n(month);
  if (m >= 10 || m <= 2) return "winter";
  if (m === 3 || m === 9) return "shoulder";
  return "summer";
}

export interface SeasonalGrade {
  /** The catalogue's grade — good conditions. */
  base: PeakDifficulty;
  /** What it is likely to be in the chosen month(s). */
  effective: PeakDifficulty;
  /** How many grades it moved. 0 means the month changes nothing. */
  steps: number;
  season: Season;
  snowLineM: number;
  /** True when the summit is probably under snow for the chosen month(s). */
  snowLikely: boolean;
  /** Short enough for a badge. */
  label: string;
  /** A sentence explaining the change, for a tooltip or a panel. */
  detail: string;
}

/**
 * Grade one month.
 *
 * Steps are conservative in the direction that matters: being told a
 * mountain is harder than it turns out to be costs you a wasted axe,
 * while the reverse costs considerably more.
 */
function gradeOneMonth(args: {
  difficulty: PeakDifficulty;
  latitude: number;
  elevationM: number;
  month: number;
}): SeasonalGrade {
  const { difficulty: base, latitude, elevationM, month } = args;
  const season = seasonFor(latitude, month);
  const snowLineM = winterSnowLineM(latitude);
  const above = elevationM - snowLineM;

  if (season === "tropical") {
    // No winter here. A high tropical summit is cold year-round, which the
    // catalogue grade already reflects; what changes is rain, and when the
    // wet season falls depends on the region, not on the latitude. Saying
    // nothing is better than guessing which months those are.
    const high = elevationM >= 4500;
    return {
      base,
      effective: base,
      steps: 0,
      season,
      snowLineM,
      snowLikely: high,
      label: high ? "Cold year-round" : "No winter season",
      detail: high
        ? "Within the tropics, so there is no winter — but at this height the summit is near or below freezing in every month. Conditions turn on the regional wet and dry seasons rather than the calendar."
        : "Within the tropics, so there is no winter season. Conditions turn on the regional wet and dry seasons rather than the calendar.",
    };
  }

  if (season === "summer") {
    return {
      base,
      effective: base,
      steps: 0,
      season,
      snowLineM,
      snowLikely: false,
      label: "Best conditions",
      detail:
        "The settled part of the year at this latitude. This is the grade the catalogue lists, which assumes conditions like these.",
    };
  }

  if (season === "shoulder") {
    // Old snow holds in gullies and on shaded ground well after the thaw.
    const lingering = above >= 0;
    const steps = above >= 500 ? 1 : 0;
    return {
      base,
      effective: escalate(base, steps),
      steps,
      season,
      snowLineM,
      snowLikely: lingering,
      label: steps > 0 ? "Snow likely" : lingering ? "Snow may linger" : "Shoulder season",
      detail: lingering
        ? `Shoulder season. Old snow holds in gullies and on north-facing ground above about ${snowLineM.toLocaleString()} m, and this summit is ${Math.round(above).toLocaleString()} m above that.`
        : "Shoulder season. Below the snow line here, so expect mud and short days rather than snow.",
    };
  }

  // Winter.
  if (above < 0) {
    return {
      base,
      effective: base,
      steps: 0,
      season,
      snowLineM,
      snowLikely: false,
      label: "Winter",
      detail: `Winter, but this summit is below the usual snow line of about ${snowLineM.toLocaleString()} m at this latitude. Expect cold, wind and little daylight rather than full winter conditions.`,
    };
  }

  // Above the snow line in winter: at least a grade harder. Two grades
  // when it is far above, or at a latitude where winter is severe at any
  // height.
  const severe = above >= 1000 || Math.abs(latitude) >= 55;
  const steps = severe ? 2 : 1;
  return {
    base,
    effective: escalate(base, steps),
    steps,
    season,
    snowLineM,
    snowLikely: true,
    label: "Winter conditions",
    detail:
      `Under snow and ice in winter: ${Math.round(above).toLocaleString()} m above the snow line for this latitude. ` +
      (base === "hike"
        ? "A summer walk-up becomes a winter climb — axe, crampons and avalanche judgement."
        : "Axe, crampons and avalanche judgement on top of the usual difficulties."),
  };
}

/**
 * Grade a month or an inclusive range of months.
 *
 * A range reports its hardest month, not an average. Someone asking about
 * March to June is asking what they need to be ready for, and the answer
 * is March.
 *
 * `from` and `to` are 0-11 and may wrap — `to` of 1 with `from` of 10 is
 * November to February, which is exactly the range a winter trip spans
 * and would otherwise be unrepresentable.
 */
export function seasonalGrade(args: {
  difficulty: PeakDifficulty;
  latitude: number;
  elevationM: number;
  /** 0-11. Defaults to the current month. */
  from?: number;
  /** 0-11 inclusive. Defaults to `from` — a single month. */
  to?: number;
}): SeasonalGrade {
  const from = args.from ?? new Date().getMonth();
  const to = args.to ?? from;

  const months: number[] = [];
  for (let m = from, guard = 0; guard < 12; guard++) {
    months.push(m);
    if (m === to) break;
    m = (m + 1) % 12;
  }

  let worst = gradeOneMonth({ ...args, month: months[0] });
  for (const month of months.slice(1)) {
    const g = gradeOneMonth({ ...args, month });
    if (g.steps > worst.steps) worst = g;
  }
  if (months.length > 1 && worst.steps > 0) {
    worst = {
      ...worst,
      detail: `${worst.detail} This is the hardest month in the range you picked.`,
    };
  }
  return worst;
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * How to describe a route that does not reach the top.
 *
 * The app used to say this with one number: `distance_to_summit_m`, the gap
 * in plan view. On a steep mountain that number is actively misleading.
 * Juneau's Perseverance Trail passes 104 m from the summit and stops 830 m
 * below it — "104 m short" reads as "very nearly there" and means the
 * opposite. Same trail, same two numbers, opposite impressions.
 *
 * Height is the honest axis for a mountain, so it is preferred wherever it
 * has been measured. The horizontal figure stays as the fallback for routes
 * imported before the elevation pass, and as the thing to say when a route
 * ends at the right height but on the wrong side of the peak.
 */

/** Below this the two are the same place; saying anything is noise. */
const NEGLIGIBLE_VERTICAL_M = 25;

/**
 * A route within this of the summit height has effectively topped out, so
 * whatever keeps it from being a summit route is horizontal — it ends on a
 * neighbouring high point, or short along the ridge. Matches the tolerance
 * the loader uses to decide `is_summit_route`.
 */
const SUMMIT_VERTICAL_TOLERANCE_M = 60;

export interface SummitGap {
  /** Short enough for a metadata row: "stops 830 m below the top". */
  label: string;
  /** Spelled out, for a tooltip or a detail line. */
  detail: string;
  /** True when measured by height rather than by plan-view distance. */
  vertical: boolean;
}

/**
 * Describe the gap between a route's end and the summit, or null when the
 * route reaches the top or there is nothing measured to report.
 */
export function describeSummitGap(args: {
  isSummitRoute: boolean;
  distanceToSummitM: number | null | undefined;
  highPointM: number | null | undefined;
  summitElevationM: number | null | undefined;
}): SummitGap | null {
  const { isSummitRoute, distanceToSummitM, highPointM, summitElevationM } = args;
  if (isSummitRoute) return null;

  const horizontal =
    typeof distanceToSummitM === "number" && Number.isFinite(distanceToSummitM)
      ? Math.max(0, Math.round(distanceToSummitM))
      : null;

  const vertical =
    typeof highPointM === "number" &&
    typeof summitElevationM === "number" &&
    Number.isFinite(highPointM) &&
    Number.isFinite(summitElevationM)
      ? Math.round(summitElevationM - highPointM)
      : null;

  // Measured, and a real climb still above you: say it in metres of height.
  if (vertical != null && vertical >= NEGLIGIBLE_VERTICAL_M) {
    const m = vertical.toLocaleString();
    return {
      label: `stops ${m} m below the top`,
      detail:
        `Tops out ${m} m below the summit` +
        (horizontal != null ? `, ${horizontal.toLocaleString()} m away in plan view.` : "."),
      vertical: true,
    };
  }

  // Measured, and it did reach summit height — so the gap is sideways.
  if (vertical != null && vertical < SUMMIT_VERTICAL_TOLERANCE_M && horizontal != null) {
    const m = horizontal.toLocaleString();
    return {
      label: `passes ${m} m from the top`,
      detail: `Reaches summit height but ends ${m} m from the summit itself.`,
      vertical: false,
    };
  }

  // Nothing measured: the old horizontal figure, labelled as what it is.
  if (horizontal != null) {
    const m = horizontal.toLocaleString();
    return {
      label: `passes ${m} m from the top`,
      detail: `Comes within ${m} m of the summit in plan view; its height has not been measured.`,
      vertical: false,
    };
  }

  return null;
}

/** Which of the three states a peak's route list is in. */
export type RouteCoverage = "summit" | "partial" | "none";

export function routeCoverage(routes: { is_summit_route: boolean }[]): RouteCoverage {
  if (routes.length === 0) return "none";
  return routes.some((r) => r.is_summit_route) ? "summit" : "partial";
}

/**
 * What to tell someone looking at a peak with no route to the top.
 *
 * These two cases were previously indistinguishable — both showed an empty
 * or unremarkable list — and they mean very different things. 30 peaks have
 * no mapped paths at all because nobody maps a footpath up Kangchenjunga.
 * 188 more have paths that genuinely stop below the summit. Saying so is
 * more useful than leaving a blank, and it stops the app looking broken on
 * exactly the most serious mountains it lists.
 */
export function coverageNotice(
  coverage: RouteCoverage,
  routeCount: number
): { title: string; body: string } | null {
  if (coverage === "summit") return null;
  if (coverage === "none") {
    return {
      title: "No mapped routes",
      body:
        "OpenStreetMap has no footpaths near this summit. That is normal for " +
        "remote and heavily glaciated peaks, where the way up is a " +
        "mountaineering line rather than a trail.",
    };
  }
  return {
    title: "No mapped route reaches the summit",
    body:
      `The ${routeCount === 1 ? "route" : `${routeCount} routes`} below ` +
      `${routeCount === 1 ? "approaches" : "approach"} this peak but ` +
      `${routeCount === 1 ? "stops" : "stop"} short of the top. The final ` +
      "section is unmapped — often scrambling or glacier travel. Treat the " +
      "end of the line as the start of the real climb.",
  };
}

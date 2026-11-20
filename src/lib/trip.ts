import { estimateMinutes, type RouteProfile } from "@/lib/terrain";

/**
 * The figures for the trip someone will actually make.
 *
 * OSM stores a summit path as a single line from trailhead to top. The
 * importer labels anything whose ends are more than 150 m apart "Out &
 * Back" — which is right, because you have to come down the way you went
 * up — but every number shown beside that label was measured on the
 * one-way line.
 *
 * So Avalanche Gulch on Mount Shasta read:
 *
 *     Out & Back · 4.7 km · ↑1,736 m · 7h 40m
 *
 * and 7h 40m was the climb alone, with no descent in it: 4.7 × 12 +
 * 1736/100 × 10 = 230 min, doubled for a technical grade. A real round
 * trip there is nearer 11h 30m, and parties take longer still. Reading
 * "Out & Back · 7h 40m" and planning a day around it is how people end up
 * descending a 65% snow slope in the dark.
 *
 * Distance and time therefore describe the whole trip. Ascent does not: it
 * stays the height you gain once, which is what every guidebook and every
 * other hiking app means by elevation gain, and doubling it would be
 * wrong rather than merely confusing.
 */
export interface TripFigures {
  /** Total distance travelled, both legs for an out-and-back. */
  distanceKm: number | null;
  /** Height gained — once, not doubled. */
  ascentM: number | null;
  /** Time for the whole trip, descent included. */
  minutes: number | null;
  /** True when the figures include a return leg. */
  roundTrip: boolean;
  /** One-way distance, for a route that is walked in both directions. */
  oneWayKm: number | null;
}

/**
 * A line is walked in both directions when it is classified "Out & Back"
 * *and* its stored geometry covers only one of them.
 *
 * The second half matters. A loop already returns to its start, and some
 * mapped lines genuinely descend again — a profile with real descent has
 * both legs in it already, and doubling those would invent a trip nobody
 * makes. Treating a measured descent of roughly nothing as the signal is
 * what distinguishes the two, with a tolerance for DEM noise rather than
 * an exact zero.
 */
const DESCENT_NOISE_M = 30;

export function isOneWayGeometry(
  routeType: string | null | undefined,
  descentM: number | null | undefined
): boolean {
  if (routeType !== "Out & Back") return false;
  if (descentM == null) return true; // unmeasured: assume the usual case
  return descentM <= DESCENT_NOISE_M;
}

export function tripFigures(args: {
  routeType: string | null | undefined;
  /** Measured off the terrain where available, else the stored column. */
  profile?: RouteProfile | null;
  distanceKm: number | null | undefined;
  ascentM: number | null | undefined;
  descentM: number | null | undefined;
  storedMinutes: number | null | undefined;
  difficulty: "hike" | "scramble" | "technical";
}): TripFigures {
  const { routeType, profile, difficulty } = args;

  const oneWayKm = profile?.distanceKm ?? args.distanceKm ?? null;
  const ascentM = profile?.ascentM ?? args.ascentM ?? null;
  const descentM = profile?.descentM ?? args.descentM ?? null;

  const roundTrip = isOneWayGeometry(routeType, descentM);

  if (oneWayKm == null || ascentM == null) {
    return {
      distanceKm: oneWayKm,
      ascentM,
      minutes: args.storedMinutes ?? null,
      roundTrip: false,
      oneWayKm,
    };
  }

  if (!roundTrip) {
    return {
      distanceKm: oneWayKm,
      ascentM,
      minutes: estimateMinutes(oneWayKm, ascentM, descentM ?? 0, difficulty),
      roundTrip: false,
      oneWayKm,
    };
  }

  // Both legs: twice the ground, climbed once and descended once.
  return {
    distanceKm: oneWayKm * 2,
    ascentM,
    minutes: estimateMinutes(oneWayKm * 2, ascentM, ascentM, difficulty),
    roundTrip: true,
    oneWayKm,
  };
}

const km = (n: number): string => (n < 1 ? `${Math.round(n * 1000)} m` : `${n.toFixed(1)} km`);

/**
 * Both distances, always, for a trip that is walked in both directions.
 *
 * Giving one number and a word was not enough. "9.5 km round trip" leaves
 * the reader to halve it to work out how far up the mountain they have to
 * get, and "4.7 km" alone caused the original bug report. A climber plans
 * against both: the one-way figure is the climb and where the turnaround
 * time applies, the round-trip figure is the day.
 */
export function describeTripDistance(trip: TripFigures): {
  /** The headline — total ground covered. */
  primary: string;
  /** The other half of the picture, or null when there is only one. */
  secondary: string | null;
} {
  if (trip.distanceKm == null) return { primary: "—", secondary: null };
  if (!trip.roundTrip || trip.oneWayKm == null) {
    return { primary: km(trip.distanceKm), secondary: null };
  }
  return {
    primary: `${km(trip.distanceKm)} round trip`,
    secondary: `${km(trip.oneWayKm)} each way`,
  };
}

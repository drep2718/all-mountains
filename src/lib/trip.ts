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
 * mapped lines genuinely undulate — a profile with real climb in both
 * directions has both legs in it already, and doubling that would invent
 * a trip nobody makes.
 *
 * The test is on the *smaller* of the two, not on descent alone, because
 * an OSM way's direction is arbitrary. Mount Washington's Nelson Crag
 * Trail is stored running down from the summit: ascent 11 m, descent
 * 1,114 m. Checking descent said "not one-way" and the 11 m was published
 * as the mountain's elevation gain. Checking the smaller of the two sees
 * a monotonic line whichever way round it was drawn.
 */
const UNDULATION_NOISE_M = 30;

export function isOneWayGeometry(
  routeType: string | null | undefined,
  ascentM: number | null | undefined,
  descentM: number | null | undefined
): boolean {
  if (routeType !== "Out & Back") return false;
  if (descentM == null || ascentM == null) return true; // unmeasured: the usual case
  return Math.min(ascentM, descentM) <= UNDULATION_NOISE_M;
}

/**
 * The height gained walking a one-way line in the uphill direction.
 *
 * You walk a summit route toward the summit, whichever end the surveyor
 * happened to start drawing from, so the climb is the larger of the two
 * figures. For a line that genuinely undulates this is not used — see
 * `isOneWayGeometry`.
 */
const uphillClimb = (ascentM: number, descentM: number | null): number =>
  Math.max(ascentM, descentM ?? 0);

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

  const roundTrip = isOneWayGeometry(routeType, ascentM, descentM);

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

  // Both legs: twice the ground, climbed once and descended once — in the
  // uphill direction, which may be the reverse of how the line is stored.
  const climb = uphillClimb(ascentM, descentM);
  return {
    distanceKm: oneWayKm * 2,
    ascentM: climb,
    minutes: estimateMinutes(oneWayKm * 2, climb, climb, difficulty),
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

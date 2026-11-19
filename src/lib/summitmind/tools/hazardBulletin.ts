/**
 * Regional avalanche/hazard bulletins — the honesty-critical tool.
 *
 * There is no single global avalanche API. Coverage is regional and patchy.
 * The whole point of this file is to make "no data for this region" a real,
 * first-class outcome the graph can act on — never silently fall through to
 * a hazard level the agent made up.
 */

import type { HazardAssessment, Source } from "../types";

export interface RegionBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/**
 * TODO: fill in the regions you actually have a bulletin source for and know
 * how to parse. Start with one — avalanche.org (US) has a documented JSON
 * API and is the easiest to get end-to-end first. Everything outside these
 * bounds should hit the "no coverage" path in getHazardBulletin below.
 *
 * RESOURCES:
 *   - avalanche.org API (unofficial docs via community reverse-engineering): https://github.com/avalanche-org/avalanche-forecast-api
 *   - Europe: avalanche.report aggregates several Alps regions: https://avalanche.report
 */
const BULLETIN_SOURCES: Array<{ name: string; bounds: RegionBounds }> = [
  // { name: "US", bounds: { minLat: 24, maxLat: 50, minLon: -125, maxLon: -66 } },
];

function findCoveringRegion(lat: number, lon: number) {
  return BULLETIN_SOURCES.find(
    (r) => lat >= r.bounds.minLat && lat <= r.bounds.maxLat && lon >= r.bounds.minLon && lon <= r.bounds.maxLon
  );
}

// TODO: this is the graceful-degradation node in miniature. Structure:
//   1. Find which (if any) region covers (lat, lon) via findCoveringRegion.
//   2. If none — return `{ level: "unknown", reasoning: "no official bulletin
//      covers this location", sources: [] }` immediately. This is a correct,
//      expected result, not an error to catch and hide.
//   3. If one does — fetch and parse that region's bulletin, map its native
//      scale (most use the 5-level North American/European danger scale) onto
//      HazardLevel, and return it with a proper Source (retrievedAt matters —
//      bulletins are often issued once a day and go stale fast).
export async function getHazardBulletin(lat: number, lon: number): Promise<HazardAssessment> {
  throw new Error("TODO: implement regional bulletin lookup with honest no-coverage fallback — see comment above");
}

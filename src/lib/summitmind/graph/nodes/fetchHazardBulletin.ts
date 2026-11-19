/**
 * Node: fetchHazardBulletin
 *
 * Same shape as fetchWeather — thin wrapper over tools/hazardBulletin.ts.
 * The one thing worth being deliberate about here: when the bulletin comes
 * back as `level: "unknown"` (no coverage), that is NOT an error and should
 * not be treated as one — it's a legitimate state that assessRisk.ts needs
 * to see and react to (e.g. treat unknown coverage as a reason for extra
 * caution in the response, not silence).
 */

import { getHazardBulletin } from "../../tools/hazardBulletin";
import type { SummitMindStateType } from "../state";

export async function fetchHazardBulletin(
  state: SummitMindStateType
): Promise<Partial<SummitMindStateType>> {
  throw new Error("TODO: call getHazardBulletin(state.lat, state.lon), return { hazard, sources: hazard.sources }");
}

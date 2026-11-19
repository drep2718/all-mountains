/**
 * Node: fetchWeather
 *
 * Thin — the real work is in tools/weather.ts. This node's only job is to
 * pull lat/lon off state, call the tool, and shape the result into a state
 * update (including appending the Source, since `sources` accumulates).
 *
 * This one's a good first node to implement — it'll tell you fast whether
 * your state.ts reducers and graph wiring are working before you tackle the
 * harder nodes.
 */

import { getWeatherSnapshot } from "../../tools/weather";
import type { SummitMindStateType } from "../state";

export async function fetchWeather(
  state: SummitMindStateType
): Promise<Partial<SummitMindStateType>> {
  throw new Error("TODO: call getWeatherSnapshot(state.lat, state.lon), return { weather, sources: [weather.source] }");
}

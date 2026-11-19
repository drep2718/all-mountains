/**
 * Open-Meteo tool — free, no API key, global coverage.
 * https://open-meteo.com/en/docs
 */

import { summitMindConfig } from "../config";
import type { WeatherSnapshot } from "../types";

interface OpenMeteoResponse {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max: number[];
  };
}

/** Plumbing only — the fetch, typed. Fully written, nothing to fill in here. */
async function fetchOpenMeteo(lat: number, lon: number): Promise<OpenMeteoResponse> {
  const url = new URL(`${summitMindConfig.openMeteo.baseUrl}/forecast`);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max"
  );
  url.searchParams.set("forecast_days", "3");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// TODO: turn the raw forecast into a WeatherSnapshot, and decide what "notable"
// means for a mountain forecast specifically — this is the part that's actually
// interesting. A few things worth thinking through before you write it:
//
//   - Mountain weather models under-resolve complex terrain: the forecast for
//     a lat/lon near a peak is often the *valley* forecast, not the summit.
//     Open-Meteo's `elevation` param helps but doesn't fully fix this — worth
//     noting the limitation in `summary` rather than pretending precision you
//     don't have.
//   - What wind speed / precip combo should actually read as a hazard signal
//     to the LLM later, vs. just informational? You're not deciding the final
//     hazard level here (that's assessRisk.ts) — just producing an honest,
//     well-labeled snapshot for it to reason over.
//
// RESOURCES:
//   - Open-Meteo docs: https://open-meteo.com/en/docs
//   - Why terrain resolution matters for mountain forecasts: https://open-meteo.com/en/docs/dwd-api (see "Terrain resolution")
export async function getWeatherSnapshot(lat: number, lon: number): Promise<WeatherSnapshot> {
  const raw = await fetchOpenMeteo(lat, lon);
  throw new Error("TODO: map OpenMeteoResponse -> WeatherSnapshot, see comment above");
}

import { describe, it } from "vitest";

// TDD per the repo convention (see src/lib/polyline.test.ts) — these are
// intentionally empty (`.todo`) since the implementation is a TODO too.
// Fill in the assertion when you implement getWeatherSnapshot; mock `fetch`
// with a captured real Open-Meteo response rather than hand-writing fixture
// JSON, so the test catches a real API shape change.
describe("getWeatherSnapshot", () => {
  it.todo("maps a normal 3-day Open-Meteo forecast into a WeatherSnapshot");
  it.todo("produces a snapshot whose summary notes low terrain resolution near a peak");
  it.todo("throws a clear error when Open-Meteo returns a non-200 response");
});

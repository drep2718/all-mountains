"use client";

import { useEffect, useState } from "react";

/**
 * Summit weather from Open-Meteo.
 *
 * No API key, no account, generous free tier, global coverage — which matters
 * when the catalogue spans 40 countries. Requested at the summit's elevation
 * so the temperature is the one you'll actually stand in, not the valley's.
 */

const WMO: Record<number, { label: string; icon: string }> = {
  0: { label: "Clear", icon: "☀️" },
  1: { label: "Mainly clear", icon: "🌤" },
  2: { label: "Partly cloudy", icon: "⛅" },
  3: { label: "Overcast", icon: "☁️" },
  45: { label: "Fog", icon: "🌫" },
  48: { label: "Rime fog", icon: "🌫" },
  51: { label: "Light drizzle", icon: "🌦" },
  53: { label: "Drizzle", icon: "🌦" },
  55: { label: "Heavy drizzle", icon: "🌧" },
  61: { label: "Light rain", icon: "🌦" },
  63: { label: "Rain", icon: "🌧" },
  65: { label: "Heavy rain", icon: "🌧" },
  71: { label: "Light snow", icon: "🌨" },
  73: { label: "Snow", icon: "🌨" },
  75: { label: "Heavy snow", icon: "❄️" },
  77: { label: "Snow grains", icon: "🌨" },
  80: { label: "Showers", icon: "🌦" },
  81: { label: "Showers", icon: "🌧" },
  82: { label: "Violent showers", icon: "⛈" },
  85: { label: "Snow showers", icon: "🌨" },
  86: { label: "Heavy snow showers", icon: "❄️" },
  95: { label: "Thunderstorm", icon: "⛈" },
  96: { label: "Thunderstorm, hail", icon: "⛈" },
  99: { label: "Thunderstorm, hail", icon: "⛈" },
};

const describe = (code: number) => WMO[code] ?? { label: "—", icon: "·" };

interface Forecast {
  current: { temperature_2m: number; wind_speed_10m: number; weather_code: number } | null;
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  } | null;
}

export default function PeakWeather({
  latitude,
  longitude,
  elevationM,
}: {
  latitude: number;
  longitude: number;
  elevationM: number;
}) {
  const [data, setData] = useState<Forecast | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error" | "offline">("loading");

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setState("offline");
        return;
      }
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
          `&elevation=${Math.round(elevationM)}` +
          `&current=temperature_2m,wind_speed_10m,weather_code` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
          `&timezone=auto&forecast_days=7`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        setData((await res.json()) as Forecast);
        setState("ok");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setState("error");
      }
    })();
    return () => ctrl.abort();
  }, [latitude, longitude, elevationM]);

  if (state === "loading") {
    return <div className="h-28 animate-pulse rounded-2xl border border-border bg-surface" />;
  }
  // Weather is live data; offline it is absent, not stale. Say which.
  if (state === "offline") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-ink-faint">
        Weather needs a connection — it is never cached, because a three-day-old
        forecast on a mountain is worse than none.
      </div>
    );
  }
  if (state === "error" || !data?.current) return null;

  const now = describe(data.current.weather_code);

  return (
    <section className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-bold text-ink">Summit weather</h2>
        <span className="text-xs text-ink-faint">at {Math.round(elevationM).toLocaleString()} m</span>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <span className="text-4xl" aria-hidden>{now.icon}</span>
        <div>
          <div className="text-2xl font-semibold text-ink">
            {Math.round(data.current.temperature_2m)}°C
          </div>
          <div className="text-sm text-ink-muted">
            {now.label} · wind {Math.round(data.current.wind_speed_10m)} km/h
          </div>
        </div>
      </div>

      {data.daily && (
        <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
          {data.daily.time.slice(0, 7).map((day, i) => (
            <div key={day} className="rounded-lg bg-ground/40 px-1 py-2 text-center">
              <div className="text-[11px] text-ink-faint">
                {i === 0
                  ? "Today"
                  : new Date(day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div className="text-lg" aria-hidden>{describe(data.daily!.weather_code[i]).icon}</div>
              <div className="text-[11px] font-medium text-ink">
                {Math.round(data.daily!.temperature_2m_max[i])}°
                <span className="text-ink-faint">
                  {" "}
                  {Math.round(data.daily!.temperature_2m_min[i])}°
                </span>
              </div>
              {data.daily!.precipitation_probability_max[i] >= 30 && (
                <div className="text-[10px] text-sky-700">
                  {data.daily!.precipitation_probability_max[i]}%
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[11px] text-ink-faint">
        Open-Meteo · mountain weather changes faster than any forecast
      </p>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { haversineM, toLines } from "@/lib/track";

interface Props {
  /** GeoJSON LineString / MultiLineString. Coordinates may carry a 3rd Z value. */
  geometry: unknown;
  ascentM?: number | null;
  descentM?: number | null;
  /** Fallback when the geometry has no Z values. */
  distanceKm?: number | null;
}

interface Sample {
  km: number;
  ele: number;
}

const W = 640;
const H = 160;
const PAD = { top: 10, right: 8, bottom: 20, left: 34 };

/**
 * Elevation profile over distance. OSM route geometry only sometimes carries
 * elevation, so this renders a real chart when Z values exist and an honest
 * "no data" state when they don't — never a fabricated curve.
 */
export default function ElevationProfile({ geometry, ascentM, descentM, distanceKm }: Props) {
  const [hover, setHover] = useState<Sample | null>(null);

  const samples = useMemo<Sample[]>(() => {
    const lines = toLines(geometry);
    const out: Sample[] = [];
    let km = 0;
    let prev: { lat: number; lng: number } | null = null;

    for (const line of lines) {
      for (const c of line) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const p = { lng: c[0], lat: c[1] };
        if (prev) km += haversineM(prev, p) / 1000;
        prev = p;
        if (c.length >= 3 && Number.isFinite(c[2])) out.push({ km, ele: c[2] });
      }
    }
    return out;
  }, [geometry]);

  const chart = useMemo(() => {
    if (samples.length < 2) return null;
    const eles = samples.map((s) => s.ele);
    const minE = Math.min(...eles);
    const maxE = Math.max(...eles);
    const maxKm = samples[samples.length - 1].km || 1;
    const span = Math.max(1, maxE - minE);

    const x = (km: number) => PAD.left + (km / maxKm) * (W - PAD.left - PAD.right);
    const y = (e: number) => PAD.top + (1 - (e - minE) / span) * (H - PAD.top - PAD.bottom);

    // Downsample so the path stays light on long trails.
    const step = Math.max(1, Math.floor(samples.length / 400));
    const pts = samples.filter((_, i) => i % step === 0 || i === samples.length - 1);
    const line = pts.map((s, i) => `${i === 0 ? "M" : "L"}${x(s.km).toFixed(1)},${y(s.ele).toFixed(1)}`).join(" ");
    const area = `${line} L${x(maxKm).toFixed(1)},${H - PAD.bottom} L${PAD.left},${H - PAD.bottom} Z`;

    return { minE, maxE, maxKm, x, y, line, area, pts };
  }, [samples]);

  if (!chart) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="mb-2 font-display font-bold text-ink">Elevation profile</h3>
        <p className="text-sm text-ink-muted">
          No elevation data mapped for this trail
          {ascentM != null && ` — total ascent is ${Math.round(ascentM)} m`}
          {distanceKm != null && ` over ${distanceKm.toFixed(1)} km`}.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display font-bold text-ink">Elevation profile</h3>
        <div className="font-mono text-xs text-ink-muted">
          {Math.round(chart.minE)}–{Math.round(chart.maxE)} m
          {ascentM != null && ` · ↑${Math.round(ascentM)} m`}
          {descentM != null && ` · ↓${Math.round(descentM)} m`}
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-40 w-full min-w-[320px]"
          role="img"
          aria-label={`Elevation from ${Math.round(chart.minE)} to ${Math.round(chart.maxE)} metres over ${chart.maxKm.toFixed(1)} kilometres`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const svgX = ((e.clientX - r.left) / r.width) * W;
            const km = ((svgX - PAD.left) / (W - PAD.left - PAD.right)) * chart.maxKm;
            let best = chart.pts[0];
            for (const p of chart.pts) {
              if (Math.abs(p.km - km) < Math.abs(best.km - km)) best = p;
            }
            setHover(best);
          }}
        >
          {[0, 0.5, 1].map((f) => {
            const e = chart.minE + f * (chart.maxE - chart.minE);
            return (
              <g key={f}>
                <line
                  x1={PAD.left} x2={W - PAD.right}
                  y1={chart.y(e)} y2={chart.y(e)}
                  stroke="currentColor" className="text-border" strokeWidth="1"
                />
                <text
                  x={PAD.left - 5} y={chart.y(e) + 3}
                  textAnchor="end" className="fill-current text-ink-faint"
                  style={{ fontSize: 9 }}
                >
                  {Math.round(e)}
                </text>
              </g>
            );
          })}

          <path d={chart.area} className="fill-current text-pine-600/15" />
          <path
            d={chart.line}
            className="stroke-current text-pine-600"
            strokeWidth="2" fill="none"
            strokeLinejoin="round" strokeLinecap="round"
          />

          {hover && (
            <g>
              <line
                x1={chart.x(hover.km)} x2={chart.x(hover.km)}
                y1={PAD.top} y2={H - PAD.bottom}
                className="stroke-current text-trail-500" strokeWidth="1" strokeDasharray="3 3"
              />
              <circle cx={chart.x(hover.km)} cy={chart.y(hover.ele)} r="3.5" className="fill-current text-trail-600" />
            </g>
          )}

          <text x={PAD.left} y={H - 6} className="fill-current text-ink-faint" style={{ fontSize: 9 }}>0 km</text>
          <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-current text-ink-faint" style={{ fontSize: 9 }}>
            {chart.maxKm.toFixed(1)} km
          </text>
        </svg>
      </div>

      <p className="mt-1 h-4 text-center font-mono text-xs text-ink-muted">
        {hover ? `${hover.km.toFixed(2)} km · ${Math.round(hover.ele)} m` : ""}
      </p>
    </div>
  );
}

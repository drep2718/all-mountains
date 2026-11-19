"use client";

import { useMemo, useState } from "react";
import type { RouteProfile } from "@/lib/terrain";

/**
 * Elevation against distance, from terrain measured under the route.
 *
 * The old chart read Z values out of the route geometry, which OSM almost
 * never carries, so it showed "no elevation data" on virtually every trail.
 * This takes a profile sampled from the same DEM the 3-D view renders, so the
 * line always exists and always matches the mountain on screen.
 */

const W = 720;
const H = 180;
const PAD = { top: 12, right: 10, bottom: 22, left: 44 };

/** Grade bands, steep to gentle. Colour carries the warning, the axis the fact. */
function gradeColor(grade: number): string {
  const g = Math.abs(grade);
  if (g >= 40) return "#c23b32";
  if (g >= 25) return "#d9792a";
  if (g >= 15) return "#c9a227";
  return "#4f8a10";
}

export default function RouteProfileChart({
  profile,
  className = "",
}: {
  profile: RouteProfile | null;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (!profile || profile.samples.length < 2) return null;
    const { samples, minEle, maxEle, distanceKm } = profile;

    // Pad the vertical range so a flat route isn't a line pinned to the floor.
    const span = Math.max(maxEle - minEle, 50);
    const lo = minEle - span * 0.12;
    const hi = maxEle + span * 0.12;

    const x = (km: number) =>
      PAD.left + (km / Math.max(distanceKm, 0.001)) * (W - PAD.left - PAD.right);
    const y = (ele: number) =>
      PAD.top + (1 - (ele - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

    // One filled band per sample pair, coloured by that segment's grade — a
    // single-colour line hides where the work actually is.
    const bands = samples.slice(1).map((s, i) => {
      const p = samples[i];
      return {
        d: `M ${x(p.km)} ${y(p.ele)} L ${x(s.km)} ${y(s.ele)} L ${x(s.km)} ${H - PAD.bottom} L ${x(p.km)} ${H - PAD.bottom} Z`,
        color: gradeColor(s.grade),
      };
    });

    const line = samples.map((s, i) => `${i ? "L" : "M"} ${x(s.km)} ${y(s.ele)}`).join(" ");

    const ticks: { ele: number; y: number }[] = [];
    const stepCandidates = [50, 100, 200, 250, 500, 1000];
    const step = stepCandidates.find((s) => (hi - lo) / s <= 5) ?? 1000;
    for (let e = Math.ceil(lo / step) * step; e <= hi; e += step) {
      ticks.push({ ele: e, y: y(e) });
    }

    const xTicks: { km: number; x: number }[] = [];
    const kmStep = distanceKm <= 3 ? 0.5 : distanceKm <= 10 ? 2 : distanceKm <= 30 ? 5 : 10;
    for (let k = 0; k <= distanceKm; k += kmStep) xTicks.push({ km: k, x: x(k) });

    return { x, y, bands, line, ticks, xTicks, lo, hi };
  }, [profile]);

  if (!profile || !geom) {
    return (
      <div className={`rounded-2xl border border-border bg-surface p-6 text-center text-sm text-ink-faint ${className}`}>
        Measuring the terrain under this route…
      </div>
    );
  }

  const samples = profile.samples;
  const active = hover == null ? null : samples[Math.min(hover, samples.length - 1)];

  return (
    <div className={`rounded-2xl border border-border bg-surface p-3 ${className}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 px-1 text-xs">
        <span className="font-semibold text-ink">Elevation</span>
        <span className="text-ink-muted">
          ↑ <span className="font-mono text-ink">{profile.ascentM.toLocaleString()} m</span>
        </span>
        <span className="text-ink-muted">
          ↓ <span className="font-mono text-ink">{profile.descentM.toLocaleString()} m</span>
        </span>
        <span className="text-ink-muted">
          high <span className="font-mono text-ink">{profile.maxEle.toLocaleString()} m</span>
        </span>
        <span className="text-ink-muted">
          steepest 200&nbsp;m <span className="font-mono text-ink">{profile.maxGrade}%</span>
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label={`Elevation profile: ${profile.distanceKm.toFixed(1)} km, ${profile.ascentM} m of ascent, steepest grade ${profile.maxGrade}%`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const frac = (px - PAD.left) / (W - PAD.left - PAD.right);
          setHover(Math.max(0, Math.min(samples.length - 1, Math.round(frac * (samples.length - 1)))));
        }}
      >
        {geom.ticks.map((t) => (
          <g key={t.ele}>
            <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} stroke="#e3e6da" strokeWidth={1} />
            <text x={PAD.left - 6} y={t.y + 3} textAnchor="end" fontSize={9} fill="#8a927d">
              {t.ele.toLocaleString()}
            </text>
          </g>
        ))}

        {geom.bands.map((b, i) => (
          <path key={i} d={b.d} fill={b.color} fillOpacity={0.3} />
        ))}
        <path d={geom.line} fill="none" stroke="#1f261b" strokeWidth={1.6} strokeLinejoin="round" />

        {geom.xTicks.map((t) => (
          <text key={t.km} x={t.x} y={H - 6} textAnchor="middle" fontSize={9} fill="#8a927d">
            {t.km % 1 === 0 ? t.km : t.km.toFixed(1)} km
          </text>
        ))}

        {active && (
          <g>
            <line
              x1={geom.x(active.km)}
              x2={geom.x(active.km)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="#1f261b"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={geom.x(active.km)} cy={geom.y(active.ele)} r={4} fill="#1f261b" />
          </g>
        )}
      </svg>

      <div className="flex items-center justify-between px-1 pt-1 text-xs">
        <span className="text-ink-muted">
          {active ? (
            <>
              <span className="font-mono text-ink">{active.km.toFixed(2)} km</span> ·{" "}
              <span className="font-mono text-ink">{Math.round(active.ele).toLocaleString()} m</span> ·{" "}
              <span className="font-mono" style={{ color: gradeColor(active.grade) }}>
                {active.grade >= 0 ? "+" : ""}
                {active.grade.toFixed(0)}%
              </span>
            </>
          ) : (
            <span className="text-ink-faint">Hover for elevation and grade</span>
          )}
        </span>
        <span className="flex items-center gap-2 text-[10px] text-ink-faint">
          {[
            ["<15%", "#4f8a10"],
            ["15–25", "#c9a227"],
            ["25–40", "#d9792a"],
            ["40%+", "#c23b32"],
          ].map(([label, c]) => (
            <span key={label} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: c }} />
              {label}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

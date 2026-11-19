"use client";

import type { Hazard, HazardLevel } from "@/lib/terrain";

/**
 * What could go wrong, with the number it was derived from.
 *
 * Every item names its evidence — the altitude, the measured grade, the
 * forecast wind — so a climber can weigh it rather than trust a label. The
 * panel says plainly that it is advisory; it is computed from a terrain model
 * and a forecast, not from local knowledge, and it cannot see a closed road,
 * a washed-out bridge or this morning's avalanche report.
 */

const STYLE: Record<HazardLevel, { box: string; dot: string; label: string }> = {
  serious: {
    box: "border-red-300 bg-red-50",
    dot: "bg-red-600",
    label: "text-red-900",
  },
  caution: {
    box: "border-amber-300 bg-amber-50",
    dot: "bg-amber-500",
    label: "text-amber-900",
  },
  info: {
    box: "border-border bg-surface",
    dot: "bg-slate-400",
    label: "text-ink",
  },
};

export default function HazardPanel({
  hazards,
  className = "",
}: {
  hazards: Hazard[];
  className?: string;
}) {
  const serious = hazards.filter((h) => h.level === "serious").length;

  if (hazards.length === 0) {
    return (
      <section className={`rounded-2xl border border-border bg-surface p-4 ${className}`}>
        <h2 className="font-display text-lg font-bold text-ink">Conditions &amp; hazards</h2>
        <p className="mt-1.5 text-sm text-ink-muted">
          Nothing flagged from elevation, terrain, season or the current forecast. That is not
          the same as safe — check a local forecast and recent trip reports before you go.
        </p>
      </section>
    );
  }

  return (
    <section className={`rounded-2xl border border-border bg-surface p-4 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-ink">Conditions &amp; hazards</h2>
        {serious > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">
            {serious} serious
          </span>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {hazards.map((h, i) => {
          const s = STYLE[h.level];
          return (
            <li key={i} className={`rounded-xl border p-3 ${s.box}`}>
              <div className="flex items-start gap-2.5">
                <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${s.dot}`} aria-hidden />
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${s.label}`}>{h.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">{h.detail}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        Derived from the summit elevation, the grade measured off the terrain model, the season
        at this latitude and the current forecast. It cannot see a closed approach road, a
        washed-out bridge or today&apos;s avalanche bulletin — check those yourself.
      </p>
    </section>
  );
}

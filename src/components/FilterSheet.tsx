"use client";

import {
  type Filters, DIFFICULTIES, ROUTE_TYPES, ACTIVITIES, FEATURES,
  LENGTH_CAP, toggle, activeFilterCount, DEFAULT_FILTERS,
} from "@/lib/filters";
import { DIFFICULTY_HEX } from "@/lib/types";

interface Props {
  open: boolean;
  filters: Filters;
  onChange: (f: Filters) => void;
  onClose: () => void;
  resultCount?: number;
}

export default function FilterSheet({ open, filters, onChange, onClose, resultCount }: Props) {
  if (!open) return null;

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const count = activeFilterCount(filters);

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-ground sm:max-w-lg sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-xl font-bold text-ink">Filters</h2>
          <button onClick={() => onChange({ ...DEFAULT_FILTERS })}
            className="text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
            disabled={count === 0}>
            Reset
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5">
          {/* Iconic summits */}
          <button
            onClick={() => set({ iconicOnly: !filters.iconicOnly })}
            className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition-colors ${
              filters.iconicOnly ? "border-[#e8b33a] bg-[#e8b33a]/10" : "border-border bg-surface"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-xl">🥇</span>
              <div>
                <div className="font-semibold text-ink">Iconic summits only</div>
                <div className="text-xs text-ink-muted">The 100 most famous peaks across your regions</div>
              </div>
            </div>
            <span className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${filters.iconicOnly ? "bg-[#e8b33a]" : "bg-surface-3"}`}>
              <span className={`h-5 w-5 rounded-full bg-white transition-transform ${filters.iconicOnly ? "translate-x-5" : ""}`} />
            </span>
          </button>

          {/* Difficulty */}
          <Section title="Difficulty">
            <div className="flex flex-wrap gap-2">
              {DIFFICULTIES.map((d) => (
                <Chip key={d} active={filters.difficulty.includes(d)}
                  onClick={() => set({ difficulty: toggle(filters.difficulty, d) })}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: DIFFICULTY_HEX[d] }} />
                  {d}
                </Chip>
              ))}
            </div>
          </Section>

          {/* Length */}
          <Section title="Length" trailing={
            <span className="font-mono text-sm text-pine-400">
              {filters.lengthMin} – {filters.lengthMax >= LENGTH_CAP ? `${LENGTH_CAP}+` : filters.lengthMax} km
            </span>
          }>
            <div className="px-1">
              <input type="range" min={0} max={LENGTH_CAP} step={1} value={filters.lengthMax}
                onChange={(e) => set({ lengthMax: Number(e.target.value) })}
                className="w-full accent-pine-500" />
              <div className="flex justify-between text-xs text-ink-faint">
                <span>0 km</span><span>{LENGTH_CAP}+ km</span>
              </div>
            </div>
          </Section>

          {/* Route type */}
          <Section title="Route type">
            <div className="flex flex-wrap gap-2">
              {ROUTE_TYPES.map((t) => (
                <Chip key={t} active={filters.routeType.includes(t)}
                  onClick={() => set({ routeType: toggle(filters.routeType, t) })}>
                  {t}
                </Chip>
              ))}
            </div>
          </Section>

          {/* Activity */}
          <Section title="Activity">
            <div className="flex flex-wrap gap-2">
              {ACTIVITIES.map((a) => (
                <Chip key={a} active={filters.activities.includes(a)}
                  onClick={() => set({ activities: toggle(filters.activities, a) })}>
                  {a}
                </Chip>
              ))}
            </div>
          </Section>

          {/* Features */}
          <Section title="Features">
            <div className="flex flex-wrap gap-2">
              {FEATURES.map((f) => (
                <Chip key={f} active={filters.features.includes(f)}
                  onClick={() => set({ features: toggle(filters.features, f) })}>
                  {f}
                </Chip>
              ))}
            </div>
          </Section>
        </div>

        {/* Footer */}
        <div className="border-t border-border p-4">
          <button onClick={onClose}
            className="w-full rounded-xl bg-pine-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-pine-500">
            {resultCount != null ? `Show ${resultCount.toLocaleString()} results` : "Apply filters"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, trailing, children }: { title: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {trailing}
      </div>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-pine-500 bg-pine-500/15 text-pine-300"
          : "border-border bg-surface text-ink-muted hover:border-border-bright hover:text-ink"
      }`}>
      {children}
    </button>
  );
}

"use client";

import { MONTHS } from "@/lib/season";

/**
 * When are you going?
 *
 * Two selects rather than one, because a trip is usually a window rather
 * than a date — "sometime in March or April" is the normal way to plan,
 * and a single month would force a guess. When both ends match it reads
 * as one month and the second select stays out of the way.
 *
 * Defaults to the current month everywhere it appears, so the grades on
 * screen describe going now unless the reader says otherwise.
 */
export default function MonthPicker({
  from,
  to,
  onChange,
  className = "",
  compact = false,
}: {
  from: number;
  to: number;
  onChange: (next: { from: number; to: number }) => void;
  className?: string;
  compact?: boolean;
}) {
  const ranged = from !== to;
  const select =
    "rounded-xl border border-border bg-surface px-2.5 py-2 text-sm text-ink outline-none transition-colors hover:border-border-bright focus:border-pine-500";

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {!compact && <span className="text-sm text-ink-muted">Going in</span>}

      <label>
        <span className="sr-only">First month</span>
        <select
          value={from}
          // Keep a single-month pick single: moving the start of a
          // one-month window should move the whole window, not silently
          // open a range the reader never asked for.
          onChange={(e) => {
            const next = Number(e.target.value);
            onChange({ from: next, to: ranged ? to : next });
          }}
          className={select}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
      </label>

      {ranged ? (
        <>
          <span className="text-sm text-ink-muted">to</span>
          <label>
            <span className="sr-only">Last month</span>
            <select
              value={to}
              onChange={(e) => onChange({ from, to: Number(e.target.value) })}
              className={select}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onChange({ from, to: from })}
            className="rounded-lg px-2 py-1 text-xs font-medium text-ink-faint transition-colors hover:text-ink"
          >
            Single month
          </button>
        </>
      ) : (
        <button
          type="button"
          // A range of one month forward is the useful starting point; an
          // empty range the reader has to widen is just a second click.
          onClick={() => onChange({ from, to: (from + 1) % 12 })}
          className="rounded-lg px-2 py-1 text-xs font-medium text-ink-faint transition-colors hover:text-ink"
        >
          + range
        </button>
      )}
    </div>
  );
}

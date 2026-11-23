"use client";

import { DIFFICULTY_LABEL, DIFFICULTY_DOT } from "@/lib/peak-types";
import type { SeasonalGrade } from "@/lib/season";

/**
 * The grade for the month you picked, and whether that differs from the
 * catalogue's.
 *
 * When a month changes nothing this is just the ordinary grade dot, so
 * the common case stays quiet. When it does change something the original
 * grade is shown struck through beside it, because "Scramble" alone would
 * hide the thing worth knowing — that this is a walk-up the rest of the
 * year and you are looking at the hard version of it.
 */
export default function SeasonBadge({
  grade,
  className = "",
}: {
  grade: SeasonalGrade;
  className?: string;
}) {
  const changed = grade.steps > 0;

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      title={grade.detail}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${DIFFICULTY_DOT[grade.effective]}`} />
      {changed && (
        <span className="text-ink-faint line-through">{DIFFICULTY_LABEL[grade.base]}</span>
      )}
      <span className={changed ? "font-semibold text-ink" : undefined}>
        {DIFFICULTY_LABEL[grade.effective]}
      </span>
      {changed && (
        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
          {grade.label}
        </span>
      )}
    </span>
  );
}

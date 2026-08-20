"use client";

interface Props {
  value: number;              // 0–5, may be fractional for an average
  onChange?: (v: number) => void;
  size?: "sm" | "md" | "lg";
}

const SIZES = { sm: "text-sm", md: "text-lg", lg: "text-2xl" };

/** Star display, or an interactive picker when `onChange` is supplied. */
export default function StarRating({ value, onChange, size = "md" }: Props) {
  const interactive = typeof onChange === "function";

  return (
    <div
      className={`inline-flex items-center gap-0.5 ${SIZES[size]}`}
      role={interactive ? "radiogroup" : "img"}
      aria-label={interactive ? "Your rating" : `Rated ${value.toFixed(1)} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        // Partial fill for averages like 4.6.
        const fill = Math.max(0, Math.min(1, value - n + 1));
        const star = (
          <span className="relative inline-block leading-none">
            <span className="text-border-bright">★</span>
            <span
              className="absolute inset-0 overflow-hidden text-[#e8b33a]"
              style={{ width: `${fill * 100}%` }}
              aria-hidden="true"
            >
              ★
            </span>
          </span>
        );

        if (!interactive) return <span key={n}>{star}</span>;

        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={Math.round(value) === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onClick={() => onChange!(n)}
            className="cursor-pointer transition-transform hover:scale-110"
          >
            {star}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useState } from "react";
import { toLines } from "@/lib/track";
import type { Route } from "@/lib/types";

/** First coordinate of a trail is its trailhead. */
function trailhead(geometry: unknown): { lat: number; lng: number } | null {
  const lines = toLines(geometry);
  const first = lines[0]?.[0];
  if (!first || first.length < 2) return null;
  return { lng: first[0], lat: first[1] };
}

export default function TrailheadActions({ route }: { route: Route }) {
  const [copied, setCopied] = useState(false);
  const head = trailhead(route.poly);
  if (!head) return null;

  const coords = `${head.lat.toFixed(6)},${head.lng.toFixed(6)}`;
  // Apple Maps on Apple devices, Google Maps elsewhere — both accept a plain
  // lat,lng destination, so no platform sniffing beyond the user agent.
  const isApple =
    typeof navigator !== "undefined" && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const directionsUrl = isApple
    ? `https://maps.apple.com/?daddr=${coords}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${coords}`;

  async function copyCoords() {
    try {
      await navigator.clipboard.writeText(coords);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="mb-1 font-display font-bold text-ink">Getting there</h3>
      <p className="mb-3 text-sm text-ink-muted">
        Trailhead at <span className="font-mono text-xs">{coords}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 rounded-xl bg-pine-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-pine-700"
        >
          🧭 Directions to trailhead
        </a>
        <button
          onClick={copyCoords}
          className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ground"
        >
          {copied ? "Copied ✓" : "Copy coordinates"}
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-faint">
        Download the trail before you go — signal often disappears at the trailhead.
      </p>
    </div>
  );
}

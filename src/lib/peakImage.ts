// Resolves a visual for any peak:
//  1. a real Wikipedia/Wikimedia photo if we've backfilled one (photo_url)
//  2. otherwise a Mapbox satellite image of the exact summit — so EVERY peak
//     has a visual, with no storage and no import.

import type { Peak } from "./types";

export function peakImageUrl(
  peak: Pick<Peak, "photo_url" | "latitude" | "longitude">,
  width = 640,
  height = 400
): string | null {
  if (peak.photo_url) return peak.photo_url;

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  // Satellite-streets, zoomed to show the summit and its terrain.
  return (
    `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/` +
    `${peak.longitude},${peak.latitude},13,0/${width}x${height}@2x?access_token=${token}`
  );
}

// True when the image is a real photo (not the satellite fallback) — lets the
// UI label satellite views so they don't masquerade as photos.
export function hasRealPhoto(peak: Pick<Peak, "photo_url">): boolean {
  return !!peak.photo_url;
}

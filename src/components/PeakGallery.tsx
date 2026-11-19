"use client";

import { useEffect, useRef, useState } from "react";
import type { Peak, PeakPhoto } from "@/lib/peak-types";

/**
 * Hero gallery for a summit.
 *
 * Every peak shows something: a Wikimedia photo where one exists, otherwise a
 * Mapbox satellite view of the exact summit, labelled as such so a rendering
 * never masquerades as a photograph.
 *
 * Commons images are licensed, so the credit is part of the image, not an
 * optional extra. If we can't attribute it we don't show it.
 */

function satelliteUrl(peak: Pick<Peak, "latitude" | "longitude">, w = 1280, h = 720): string | null {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  return (
    `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/` +
    `${peak.longitude},${peak.latitude},13,0/${w}x${h}@2x?access_token=${token}`
  );
}

interface Slide {
  url: string;
  credit: string | null;
  license: string | null;
  isSatellite: boolean;
}

/**
 * The Commons filename inside any of its URL forms.
 * The same image appears as `/commons/a/ab/Name.jpg` and
 * `/commons/thumb/a/ab/Name.jpg/1600px-Name.jpg`, so compare the file, not
 * the URL.
 */
function fileKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) return null;
    // A thumb's last segment is "<width>px-<Name>"; strip the size prefix.
    return decodeURIComponent(last.replace(/^\d+px-/, "")).toLowerCase();
  } catch {
    return null;
  }
}

export default function PeakGallery({
  peak,
  photos,
}: {
  peak: Peak;
  photos: PeakPhoto[];
}) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);

  const sat = satelliteUrl(peak);

  const fromCommons = photos
    .filter((p) => !failed.has(p.url))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => ({
      url: p.url,
      credit: p.credit,
      license: p.license,
      isSatellite: false,
    }));

  /**
   * Lead with the picture Wikipedia's editors chose.
   *
   * A Commons category is ordered by filename, not quality, so its first entry
   * is often a townscape with the mountain somewhere behind it — Mount
   * Whitney's led with a street in Lone Pine. Wikipedia's lead image is
   * already a considered choice.
   *
   * It is *promoted*, not prepended: `hero_photo_url` is a bare URL with no
   * author or licence attached, and Commons images may not be shown without
   * attribution. Matching it to our own Commons row by filename gets the right
   * picture *and* keeps the credit. If there's no match we leave the order
   * alone rather than display something we can't attribute.
   */
  const heroFile = fileKey(peak.hero_photo_url);
  const heroIndex = heroFile
    ? fromCommons.findIndex((p) => fileKey(p.url) === heroFile)
    : -1;
  const ordered =
    heroIndex > 0
      ? [fromCommons[heroIndex], ...fromCommons.filter((_, i) => i !== heroIndex)]
      : fromCommons;

  const slides: Slide[] = [
    ...ordered,
    ...(sat ? [{ url: sat, credit: null, license: null, isSatellite: true }] : []),
  ];

  // Keep the dot indicator in step with a swipe.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const i = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1));
      setIndex((prev) => (prev === i ? prev : i));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  function go(to: number) {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: to * el.clientWidth, behavior: "smooth" });
  }

  if (slides.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-700 sm:h-96">
        <span className="text-8xl opacity-20">⛰</span>
      </div>
    );
  }

  const current = slides[Math.min(index, slides.length - 1)];

  return (
    <div className="relative overflow-hidden rounded-2xl bg-slate-900">
      <div
        ref={scroller}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((s, i) => (
          <img
            key={s.url}
            src={s.url}
            alt={
              s.isSatellite
                ? `Satellite view of ${peak.name}`
                : `${peak.name}${s.credit ? ` — photo by ${s.credit}` : ""}`
            }
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
            onError={() => setFailed((f) => new Set(f).add(s.url))}
            className="h-72 w-full flex-none snap-center object-cover sm:h-[26rem]"
          />
        ))}
      </div>

      {/* Satellite views are renderings, not photographs. Say so. */}
      {current?.isSatellite && (
        <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white backdrop-blur">
          🛰 Satellite view
        </span>
      )}

      {slides.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={() => go(Math.max(0, index - 1))}
            disabled={index === 0}
            className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 p-2 text-white backdrop-blur transition hover:bg-black/70 disabled:opacity-0 sm:block"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={() => go(Math.min(slides.length - 1, index + 1))}
            disabled={index >= slides.length - 1}
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 p-2 text-white backdrop-blur transition hover:bg-black/70 disabled:opacity-0 sm:block"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>

          <div className="pointer-events-none absolute bottom-16 left-0 right-0 flex justify-center gap-1.5">
            {slides.map((s, i) => (
              <span
                key={s.url}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-white" : "w-1.5 bg-white/50"
                }`}
              />
            ))}
          </div>
        </>
      )}

      {/* Attribution rides with the image; Commons licensing requires it. */}
      {current && !current.isSatellite && (current.credit || current.license) && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-2 pt-10">
          <p className="truncate text-[11px] text-white/70">
            {current.credit ?? "Unknown author"}
            {current.license ? ` · ${current.license}` : ""} · Wikimedia Commons
          </p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { buildStyle, LABEL_FONT } from "@/lib/mapStyle";

const PROJECTION_KEY = "am.map.projection";

export interface MapPeak {
  slug: string;
  name: string;
  elevation_m: number;
  latitude: number;
  longitude: number;
  country: string;
  category: string;
}

/**
 * Every peak in the catalogue, with the ones you've stood on picked out in
 * gold.
 *
 * The whole catalogue is loaded as one GeoJSON source and drawn by two circle
 * layers. 1,032 points is nothing for GL — it is one draw call, so panning
 * stays at 60 fps and there is no viewport refetching to get wrong.
 */
export default function SummitMap({
  peaks,
  summited,
  onSelect,
}: {
  peaks: MapPeak[];
  summited: Set<string>;
  onSelect?: (slug: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);

  /**
   * Globe or flat.
   *
   * The globe is the better opening shot — a catalogue spanning 40 countries
   * reads as a planet. But a globe is poor for scanning and comparing: half
   * your mountains are round the back, and area is distorted at the limb.
   * Flat (Web Mercator) is what you want once you're actually looking.
   *
   * Read lazily from localStorage. Safe without a guard because this component
   * is only ever loaded with `ssr: false`, so there is no server render to
   * mismatch.
   */
  const [projection, setProjection] = useState<"globe" | "mercator">(() => {
    try {
      const saved = window.localStorage.getItem(PROJECTION_KEY);
      return saved === "mercator" || saved === "globe" ? saved : "globe";
    } catch {
      return "globe";
    }
  });
  // Handlers are registered once but must see the latest props.
  const latest = useRef({ peaks, summited, onSelect });
  useEffect(() => {
    latest.current = { peaks, summited, onSelect };
  }, [peaks, summited, onSelect]);

  // The init effect must not depend on `projection`, or changing it would tear
  // the map down and rebuild it.
  const projectionRef = useRef(projection);
  useEffect(() => {
    projectionRef.current = projection;
  }, [projection]);

  // Switching is a live call on the existing map, not a re-init.
  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.setProjection(projection);
    try {
      window.localStorage.setItem(PROJECTION_KEY, projection);
    } catch {
      /* private window — the choice just won't persist */
    }
  }, [projection, ready]);

  // --- init ---
  useEffect(() => {
    if (map.current || !container.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    mapboxgl.accessToken = token;

    const m = new mapboxgl.Map({
      container: container.current,
      style: buildStyle("outdoors", token),
      center: [-30, 40],
      zoom: 1.4,
      attributionControl: false,
      // Read from a ref so re-renders never re-init the map.
      projection: projectionRef.current,
    });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

    m.on("load", () => {
      m.addSource("peaks", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Unsummited: small, quiet. Present so you can see what's left.
      m.addLayer({
        id: "peaks-todo",
        type: "circle",
        source: "peaks",
        filter: ["==", ["get", "done"], false],
        paint: {
          // Sized to stay legible at world zoom. At 2px/55% the whole
          // catalogue was technically rendered and effectively invisible,
          // which defeats the point of opening on a map.
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3, 4, 4, 8, 6, 12, 8],
          "circle-color": "#4a5a47",
          "circle-opacity": 0.8,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 8, 1.2],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-opacity": 0.9,
        },
      });

      // Summited: gold, larger, drawn on top.
      m.addLayer({
        id: "peaks-done",
        type: "circle",
        source: "peaks",
        filter: ["==", ["get", "done"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 5, 4, 7, 8, 9, 12, 12],
          "circle-color": "#e8a000",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      m.addLayer({
        id: "peaks-label",
        type: "symbol",
        source: "peaks",
        minzoom: 7,
        layout: {
          "text-field": ["get", "name"],
          "text-font": [LABEL_FONT],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: {
          // The outdoors style is light, so labels are dark with a light halo.
          "text-color": "#1f261b",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.2,
        },
      });

      for (const layer of ["peaks-done", "peaks-todo"]) {
        m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
        m.on("click", layer, (e) => {
          const f = e.features?.[0];
          const slug = f?.properties?.slug as string | undefined;
          if (!slug) return;
          const peak = latest.current.peaks.find((p) => p.slug === slug);
          if (!peak) return;
          const done = latest.current.summited.has(slug);
          new mapboxgl.Popup({ offset: 12, closeButton: false })
            .setLngLat([peak.longitude, peak.latitude])
            .setHTML(
              `<div style="font:500 13px system-ui;color:#0b0f14;min-width:140px">
                 <div style="font-weight:700">${escapeHtml(peak.name)}</div>
                 <div style="color:#5b6670;font-size:11px;margin-top:2px">
                   ${peak.elevation_m.toLocaleString()} m · ${escapeHtml(peak.country)}
                 </div>
                 <div style="margin-top:6px;font-size:11px;color:${done ? "#9a7410" : "#2e7d4f"}">
                   ${done ? "✓ Summited" : "Not yet climbed"}
                 </div>
                 <a href="/peaks/${encodeURIComponent(slug)}"
                    style="display:inline-block;margin-top:8px;font-size:12px;color:#2e7d4f;font-weight:600">
                   Open ›
                 </a>
               </div>`
            )
            .addTo(m);
          latest.current.onSelect?.(slug);
        });
      }

      setReady(true);
    });

    // Dev-only handle. A GL map is otherwise a black box from the outside:
    // there is no way to ask "did the source get my 1,032 features?" without
    // one, and that question comes up every time a layer looks empty.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __summitMap?: mapboxgl.Map }).__summitMap = m;
    }

    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // --- data ---
  useEffect(() => {
    if (!ready || !map.current) return;
    const src = map.current.getSource("peaks") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: peaks.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
        properties: {
          slug: p.slug,
          name: p.name,
          done: summited.has(p.slug),
        },
      })),
    });
  }, [ready, peaks, summited]);

  // Frame the summited peaks once there are some — the map is about your
  // progress, so it should open on your progress, not on the Atlantic.
  const framed = useRef(false);
  useEffect(() => {
    if (!ready || !map.current || framed.current) return;
    const done = peaks.filter((p) => summited.has(p.slug));
    if (done.length === 0) return;
    framed.current = true;
    const b = new mapboxgl.LngLatBounds();
    for (const p of done) b.extend([p.longitude, p.latitude]);
    map.current.fitBounds(b, { padding: 64, maxZoom: 8, duration: 0 });
  }, [ready, peaks, summited]);

  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-border bg-surface text-sm text-ink-faint">
        Map unavailable — no Mapbox token configured.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full rounded-2xl" />

      <div
        role="group"
        aria-label="Map projection"
        className="absolute left-2 top-2 flex overflow-hidden rounded-lg border border-black/10 bg-white/95 shadow-sm backdrop-blur"
      >
        {(["globe", "mercator"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setProjection(p)}
            aria-pressed={projection === p}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
              projection === p
                ? "bg-pine-600 text-white"
                : "text-slate-700 hover:bg-black/5"
            }`}
          >
            {p === "globe" ? "🌍 Globe" : "🗺 Flat"}
          </button>
        ))}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

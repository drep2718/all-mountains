"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { decodeSegments, type LngLat } from "@/lib/polyline";
import { profileFromTerrain, type RouteProfile } from "@/lib/terrain";
import type { Peak, PeakRoute } from "@/lib/peak-types";

/**
 * The mountain in three dimensions, with the summit path drawn on it.
 *
 * Mapbox's terrain DEM draped with satellite imagery, pitched, with an
 * atmosphere. The same DEM is then read back with `queryTerrainElevation` to
 * measure each route's real ascent and grade — OSM geometry carries no
 * elevation, so without this the profile would be empty and the ascent a
 * guess.
 */

const DEM_SOURCE = "mapbox-dem";
/**
 * Vertical exaggeration. 1.0 is truthful but reads flat on screen, because a
 * 2 km peak across 10 km of ground really is a gentle bump at true scale.
 * 1.4 looks like the mountain feels without turning it into a cartoon.
 */
const EXAGGERATION = 1.4;

export type BaseStyle = "satellite" | "outdoors";

const STYLE_URL: Record<BaseStyle, string> = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  outdoors: "mapbox://styles/mapbox/outdoors-v12",
};

export default function PeakTerrain3D({
  peak,
  routes,
  activeRouteId,
  onRouteHover,
  onProfile,
  className = "",
}: {
  peak: Peak;
  routes: PeakRoute[];
  activeRouteId?: number | null;
  onRouteHover?: (id: number | null) => void;
  /** Profiles measured off the terrain, keyed by route id. */
  onProfile?: (profiles: Map<number, RouteProfile>) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [style, setStyle] = useState<BaseStyle>("satellite");
  const [ready, setReady] = useState(false);
  const [orbiting, setOrbiting] = useState(false);
  const profiled = useRef(false);

  const latest = useRef({ peak, routes, activeRouteId, onRouteHover, onProfile });
  useEffect(() => {
    latest.current = { peak, routes, activeRouteId, onRouteHover, onProfile };
  });

  /** Everything that must be re-added after a style change. */
  const addTerrainAndRoutes = useCallback((m: mapboxgl.Map) => {
    const { peak: p, routes: rs } = latest.current;

    if (!m.getSource(DEM_SOURCE)) {
      m.addSource(DEM_SOURCE, {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
    }
    m.setTerrain({ source: DEM_SOURCE, exaggeration: EXAGGERATION });

    if (!m.getLayer("sky")) {
      m.addLayer({
        id: "sky",
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun": [0.0, 90.0],
          "sky-atmosphere-sun-intensity": 15,
        },
      });
    }
    m.setFog({
      range: [1, 12],
      color: "#dce4ea",
      "high-color": "#a8c7e0",
      "horizon-blend": 0.08,
      "space-color": "#0b1b2b",
      "star-intensity": 0.05,
    });

    // Routes, as lines laid on the terrain.
    const features: GeoJSON.Feature[] = [];
    for (const r of rs) {
      for (const line of decodeSegments(r.poly)) {
        if (line.length < 2) continue;
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: line },
          properties: { id: r.id, name: r.name ?? "Unnamed path", summit: r.is_summit_route },
        });
      }
    }

    if (!m.getSource("routes")) {
      m.addSource("routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
    } else {
      (m.getSource("routes") as mapboxgl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features,
      });
    }

    if (!m.getLayer("routes-casing")) {
      // A dark casing under a bright line is what keeps a path readable over
      // both snow and dark rock. One colour alone disappears on one of them.
      m.addLayer({
        id: "routes-casing",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#10200f",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 9],
          "line-opacity": 0.55,
        },
      });
      m.addLayer({
        id: "routes-line",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "summit"], true], "#ffd34d",
            "#8fd14f",
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 16, 5],
        },
      });
    }

    // Summit marker, raised to sit on the terrain surface.
    if (!m.getSource("summit")) {
      m.addSource("summit", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
              properties: { name: p.name, ele: `${p.elevation_m.toLocaleString()} m` },
            },
          ],
        },
      });
      m.addLayer({
        id: "summit-dot",
        type: "circle",
        source: "summit",
        paint: {
          "circle-radius": 7,
          "circle-color": "#e8a000",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#ffffff",
        },
      });
      m.addLayer({
        id: "summit-label",
        type: "symbol",
        source: "summit",
        layout: {
          "text-field": ["concat", ["get", "name"], "  ", ["get", "ele"]],
          "text-size": 13,
          "text-offset": [0, -1.6],
          "text-anchor": "bottom",
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#1a1a1a",
          "text-halo-width": 1.6,
        },
      });
    }
  }, []);

  // --- init ---
  useEffect(() => {
    if (map.current || !container.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    mapboxgl.accessToken = token;

    const m = new mapboxgl.Map({
      container: container.current,
      style: STYLE_URL.satellite,
      center: [peak.longitude, peak.latitude],
      zoom: 13,
      pitch: 68,
      bearing: -20,
      antialias: true,
      attributionControl: false,
    });
    m.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
    m.scrollZoom.disable(); // the page scrolls past this; ctrl+scroll still zooms

    m.on("style.load", () => {
      addTerrainAndRoutes(m);
      setReady(true);
    });

    for (const layer of ["routes-line", "routes-casing"]) {
      m.on("mouseenter", layer, (e) => {
        m.getCanvas().style.cursor = "pointer";
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "number") latest.current.onRouteHover?.(id);
      });
      m.on("mouseleave", layer, () => {
        m.getCanvas().style.cursor = "";
        latest.current.onRouteHover?.(null);
      });
    }

    map.current = m;
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __peakMap?: mapboxgl.Map }).__peakMap = m;
    }
    return () => {
      m.remove();
      map.current = null;
    };
    // Intentionally once: the peak is fixed for the lifetime of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Switch base style without losing the terrain.
   *
   * Guarded by the style already applied. Without the guard this effect fires
   * the moment `ready` flips true and calls setStyle with the style that is
   * already loaded; Mapbox diffs that as a style change, drops the custom DEM
   * source, sky and route layers, and — because the style did not actually
   * reload — never fires `style.load`, so nothing puts them back. The map ends
   * up flat and empty with no error anywhere.
   */
  const appliedStyle = useRef<BaseStyle>("satellite");
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || appliedStyle.current === style) return;
    appliedStyle.current = style;
    m.once("style.load", () => addTerrainAndRoutes(m));
    m.setStyle(STYLE_URL[style]);
  }, [style, ready, addTerrainAndRoutes]);

  // --- highlight the active route ---
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getLayer("routes-line")) return;
    m.setPaintProperty("routes-line", "line-width", [
      "interpolate",
      ["linear"],
      ["zoom"],
      10,
      ["case", ["==", ["get", "id"], activeRouteId ?? -1], 4, 2],
      16,
      ["case", ["==", ["get", "id"], activeRouteId ?? -1], 8, 5],
    ]);
  }, [activeRouteId, ready]);

  /**
   * Measure the routes once the DEM covering them has actually loaded.
   *
   * `queryTerrainElevation` returns null for tiles that are not in memory, so
   * reading too early silently yields a flat profile. Wait for idle, try, and
   * retry on the next idle if anything came back null.
   */
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || profiled.current) return;

    const attempt = () => {
      if (profiled.current) return;
      const { routes: rs, onProfile: cb } = latest.current;
      if (!cb || rs.length === 0) return;

      const out = new Map<number, RouteProfile>();
      let complete = true;
      for (const r of rs) {
        const lines = decodeSegments(r.poly);
        const flat: LngLat[] = lines.flat();
        if (flat.length < 2) continue;
        const prof = profileFromTerrain(m, flat);
        if (prof) out.set(r.id, prof);
        else complete = false;
      }
      if (out.size > 0) cb(out);
      if (complete && out.size === rs.length) {
        profiled.current = true;
        m.off("idle", attempt);
      }
    };

    m.on("idle", attempt);
    return () => {
      m.off("idle", attempt);
    };
  }, [ready, routes]);

  // --- slow orbit ---
  useEffect(() => {
    const m = map.current;
    if (!m || !orbiting) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      m.setBearing(m.getBearing() + dt * 6);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Any interaction ends the orbit — fighting the user's drag is maddening.
    const stop = () => setOrbiting(false);
    m.on("mousedown", stop);
    m.on("touchstart", stop);
    return () => {
      cancelAnimationFrame(raf);
      m.off("mousedown", stop);
      m.off("touchstart", stop);
    };
  }, [orbiting]);

  const frameRoutes = useCallback(() => {
    const m = map.current;
    if (!m) return;
    const b = new mapboxgl.LngLatBounds();
    let any = false;
    for (const r of latest.current.routes) {
      for (const line of decodeSegments(r.poly)) {
        for (const c of line) {
          b.extend(c as [number, number]);
          any = true;
        }
      }
    }
    b.extend([latest.current.peak.longitude, latest.current.peak.latitude]);
    if (any) m.fitBounds(b, { padding: 70, pitch: 62, bearing: m.getBearing(), duration: 1200 });
    else
      m.easeTo({
        center: [latest.current.peak.longitude, latest.current.peak.latitude],
        zoom: 13.5,
        pitch: 68,
        duration: 1200,
      });
  }, []);

  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-border bg-surface text-sm text-ink-faint">
        3D view unavailable — no Mapbox token configured.
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`}>
      <div ref={container} className="h-full w-full" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2">
        <div className="pointer-events-auto flex overflow-hidden rounded-lg border border-black/10 bg-white/95 shadow-sm">
          {(["satellite", "outdoors"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStyle(s)}
              aria-pressed={style === s}
              className={`px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                style === s ? "bg-pine-600 text-white" : "text-slate-700 hover:bg-black/5"
              }`}
            >
              {s === "satellite" ? "🛰 Satellite" : "🗺 Topo"}
            </button>
          ))}
        </div>

        <div className="pointer-events-auto flex gap-1.5">
          <button
            type="button"
            onClick={frameRoutes}
            className="rounded-lg border border-black/10 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-white"
          >
            Fit route
          </button>
          <button
            type="button"
            onClick={() => setOrbiting((o) => !o)}
            aria-pressed={orbiting}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
              orbiting
                ? "border-pine-600 bg-pine-600 text-white"
                : "border-black/10 bg-white/95 text-slate-700 hover:bg-white"
            }`}
          >
            {orbiting ? "◼ Stop" : "⟳ Orbit"}
          </button>
        </div>
      </div>

      <p className="pointer-events-none absolute bottom-7 left-2 rounded bg-black/45 px-2 py-1 text-[10px] text-white/90 backdrop-blur">
        Drag to turn · ctrl+drag to tilt · elevation ×{EXAGGERATION}
      </p>
    </div>
  );
}

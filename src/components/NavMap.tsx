"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { LngLat } from "@/lib/polyline";
import { profileFromTerrain, type RouteProfile } from "@/lib/terrain";

/**
 * The live navigation map.
 *
 * Deliberately plain next to the 3-D peak view: on a mountain you want to see
 * the line, where you are, and which way you are drifting — not an atmosphere.
 * Tiles come from the same unversioned cache a mountain download fills, so
 * this renders with no signal.
 */
export default function NavMap({
  routeLine,
  summit,
  position,
  heading,
  track,
  offRoute,
  onProfile,
  className = "",
}: {
  routeLine: LngLat[];
  summit: LngLat;
  position: LngLat | null;
  /** Device heading in degrees, when known. */
  heading?: number | null;
  /** The track walked so far. */
  track?: LngLat[];
  offRoute?: boolean;
  /** Reports the route's profile once the DEM under it has loaded. */
  onProfile?: (p: RouteProfile | null) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (map.current || !container.current) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    mapboxgl.accessToken = token;

    const start = position ?? routeLine[0] ?? summit;
    const m = new mapboxgl.Map({
      container: container.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: start,
      zoom: 15,
      attributionControl: false,
    });
    m.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

    m.on("load", () => {
      /**
       * The DEM is loaded but not exaggerated, so the map stays flat while
       * `queryTerrainElevation` still works. That is what lets navigation
       * report how much climbing is left — the route rows carry no ascent,
       * because OSM geometry has no elevation.
       */
      m.addSource("nav-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
      m.setTerrain({ source: "nav-dem", exaggeration: 0 });

      m.addSource("route", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: routeLine }, properties: {} },
      });
      m.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#10200f", "line-width": 9, "line-opacity": 0.4 },
      });
      m.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffd34d", "line-width": 5 },
      });

      m.addSource("track", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
      });
      m.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#2563eb", "line-width": 4, "line-opacity": 0.9 },
      });

      m.addSource("summit", {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "Point", coordinates: summit }, properties: {} },
      });
      m.addLayer({
        id: "summit-dot",
        type: "circle",
        source: "summit",
        paint: {
          "circle-radius": 8,
          "circle-color": "#e8a000",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      m.addSource("me", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "me-halo",
        type: "circle",
        source: "me",
        paint: {
          "circle-radius": 16,
          "circle-color": "#2563eb",
          "circle-opacity": 0.18,
        },
      });
      m.addLayer({
        id: "me-dot",
        type: "circle",
        source: "me",
        paint: {
          "circle-radius": 7,
          "circle-color": "#2563eb",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });

      setReady(true);
    });

    // A deliberate pan means the walker wants to look around; stop chasing them.
    m.on("dragstart", () => setFollow(false));

    map.current = m;
    // Dev-only handle; a GL map is a black box from the outside otherwise.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __navMap?: mapboxgl.Map }).__navMap = m;
    }
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route geometry can arrive after the map (offline bundle, then network).
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("route") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: routeLine },
      properties: {},
    });
  }, [routeLine, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("track") as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates: track ?? [] },
      properties: {},
    });
  }, [track, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const src = m.getSource("me") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: position
        ? [{ type: "Feature", geometry: { type: "Point", coordinates: position }, properties: {} }]
        : [],
    });
    if (position && follow) {
      m.easeTo({
        center: position,
        bearing: heading ?? m.getBearing(),
        duration: 600,
      });
    }
  }, [position, heading, follow, ready]);

  /**
   * Measure the route against the terrain once its DEM tiles are in memory.
   * queryTerrainElevation returns null for tiles that are not loaded, so this
   * retries on each idle until every sample reads.
   */
  const profiled = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !onProfile || routeLine.length < 2) return;
    const attempt = () => {
      if (profiled.current) return;
      const prof = profileFromTerrain(m, routeLine);
      if (prof) {
        profiled.current = true;
        onProfile(prof);
        m.off("idle", attempt);
      }
    };
    m.on("idle", attempt);
    return () => {
      m.off("idle", attempt);
    };
  }, [ready, routeLine, onProfile]);

  // Off-route turns the position marker red — the one state change you must
  // not miss while glancing at a phone in the wind.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getLayer("me-dot")) return;
    const c = offRoute ? "#dc2626" : "#2563eb";
    m.setPaintProperty("me-dot", "circle-color", c);
    m.setPaintProperty("me-halo", "circle-color", c);
  }, [offRoute, ready]);

  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    return (
      <div className={`flex items-center justify-center rounded-2xl border border-border bg-surface text-sm text-ink-faint ${className}`}>
        Map unavailable — no Mapbox token.
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`}>
      <div ref={container} className="h-full w-full" />
      {!follow && position && (
        <button
          type="button"
          onClick={() => setFollow(true)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-pine-600 px-4 py-2 text-sm font-semibold text-white shadow-lg"
        >
          Re-centre
        </button>
      )}
    </div>
  );
}

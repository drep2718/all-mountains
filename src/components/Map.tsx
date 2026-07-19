"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Peak, Route } from "@/lib/types";
import { getDifficulty, DIFFICULTY_HEX } from "@/lib/types";

export interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  zoom: number;
}

interface MapProps {
  peaks: Peak[];
  routes: Route[];
  initialCenter: [number, number];
  onBoundsChange: (bounds: Bounds) => void;
  onPeakClick?: (peak: Peak) => void;
  onRouteClick?: (route: Route) => void;
  activeRouteId?: number;
  // When set, the map flies to fit this [minLng, minLat, maxLng, maxLat] box.
  focusBounds?: [number, number, number, number] | null;
}

function peaksToGeoJSON(peaks: Peak[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: peaks.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
      properties: {
        id: p.id,
        name: p.name || "Unnamed Peak",
        elevation: p.elevation,
        country: p.country,
        color: DIFFICULTY_HEX[getDifficulty(p.elevation)],
        iconic: p.is_iconic ? 1 : 0,
      },
    })),
  };
}

function routesToGeoJSON(routes: Route[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: { id: r.id, name: r.name || "Unnamed Route" },
    })),
  };
}

export default function Map({
  peaks,
  routes,
  initialCenter,
  onBoundsChange,
  onPeakClick,
  onRouteClick,
  activeRouteId,
  focusBounds,
}: MapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef({ onBoundsChange, onPeakClick, onRouteClick });
  cb.current = { onBoundsChange, onPeakClick, onRouteClick };

  const emitBounds = useCallback(() => {
    if (!map.current) return;
    const b = map.current.getBounds();
    if (!b) return;
    cb.current.onBoundsChange({
      minLat: b.getSouth(),
      minLng: b.getWest(),
      maxLat: b.getNorth(),
      maxLng: b.getEast(),
      zoom: map.current.getZoom(),
    });
  }, []);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [initialCenter[1], initialCenter[0]],
      zoom: 8,
    });
    map.current = m;

    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true,
      }),
      "top-right"
    );

    m.on("load", () => {
      // --- ROUTES (drawn under peaks) ---
      m.addSource("routes", { type: "geojson", data: routesToGeoJSON([]) });
      m.addLayer({
        id: "route-lines-casing",
        type: "line",
        source: "routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#0e100d", "line-width": 5, "line-opacity": 0.5 },
      });
      m.addLayer({
        id: "route-lines",
        type: "line",
        source: "routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "id"], activeRouteId ?? -1],
            "#f2a982",
            "#e8814e",
          ],
          "line-width": ["case", ["==", ["get", "id"], activeRouteId ?? -1], 4, 2.5],
          "line-opacity": 0.9,
        },
      });

      // --- PEAKS (clustered) ---
      m.addSource("peaks", {
        type: "geojson",
        data: peaksToGeoJSON([]),
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 48,
      });

      // Cluster bubbles — sized & tinted by how many peaks they hold
      m.addLayer({
        id: "clusters",
        type: "circle",
        source: "peaks",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#1f7d5e", 10,
            "#2e9b76", 50,
            "#4fc78f",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            16, 10, 20, 50, 26,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "rgba(238,242,234,0.35)",
          "circle-opacity": 0.92,
        },
      });
      m.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "peaks",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 13,
        },
        paint: { "text-color": "#0e100d" },
      });

      // Individual peaks
      m.addLayer({
        id: "peak-point",
        type: "circle",
        source: "peaks",
        filter: ["!", ["has", "point_count"]],
        paint: {
          // Iconic summits render gold and larger than regular peaks
          "circle-color": ["case", ["==", ["get", "iconic"], 1], "#e8b33a", ["get", "color"]],
          "circle-radius": ["case", ["==", ["get", "iconic"], 1], 9, 6],
          "circle-stroke-width": ["case", ["==", ["get", "iconic"], 1], 3, 2],
          "circle-stroke-color": ["case", ["==", ["get", "iconic"], 1], "#ffffff", "rgba(238,242,234,0.75)"],
        },
      });
      // A star glyph on top of iconic peaks
      m.addLayer({
        id: "iconic-star",
        type: "symbol",
        source: "peaks",
        filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "iconic"], 1]],
        layout: { "text-field": "★", "text-size": 11, "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": "#3d2c00" },
      });
      m.addLayer({
        id: "peak-label",
        type: "symbol",
        source: "peaks",
        filter: ["!", ["has", "point_count"]],
        minzoom: 10,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 11,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: {
          "text-color": "#eef2ea",
          "text-halo-color": "#0e100d",
          "text-halo-width": 1.4,
        },
      });

      // Click a cluster → zoom in to expand it
      m.on("click", "clusters", (e) => {
        const features = m.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        const clusterId = features[0].properties?.cluster_id;
        const src = m.getSource("peaks") as mapboxgl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom == null) return;
          const geom = features[0].geometry as GeoJSON.Point;
          m.easeTo({ center: geom.coordinates as [number, number], zoom });
        });
      });

      // Click an individual peak (works on the gold star overlay too)
      const handlePeakClick = (e: mapboxgl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as { id: number };
        const peak = peaksRef.current.find((p) => p.id === Number(props.id));
        if (peak) cb.current.onPeakClick?.(peak);
      };
      m.on("click", "peak-point", handlePeakClick);
      m.on("click", "iconic-star", handlePeakClick);

      // Click a route line
      m.on("click", "route-lines", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as { id: number };
        const route = routesRef.current.find((r) => r.id === Number(props.id));
        if (route) cb.current.onRouteClick?.(route);
      });

      for (const layer of ["clusters", "peak-point", "iconic-star", "route-lines"]) {
        m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
      }

      setReady(true);
      emitBounds();
    });

    // Guarantee an initial fetch once the map has settled (covers the race
    // where `load` fires before the container has final dimensions)
    m.once("idle", emitBounds);
    m.on("moveend", emitBounds);

    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Keep refs to latest data for event handlers
  const peaksRef = useRef(peaks);
  const routesRef = useRef(routes);
  peaksRef.current = peaks;
  routesRef.current = routes;

  // Push peak data into the source
  useEffect(() => {
    if (!ready || !map.current) return;
    const src = map.current.getSource("peaks") as mapboxgl.GeoJSONSource | undefined;
    src?.setData(peaksToGeoJSON(peaks));
  }, [peaks, ready]);

  // Push route data into the source
  useEffect(() => {
    if (!ready || !map.current) return;
    const src = map.current.getSource("routes") as mapboxgl.GeoJSONSource | undefined;
    src?.setData(routesToGeoJSON(routes));
  }, [routes, ready]);

  // Fly to fit a focus bounding box (used when isolating one route)
  useEffect(() => {
    if (!ready || !map.current || !focusBounds) return;
    const [minLng, minLat, maxLng, maxLat] = focusBounds;
    map.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
      padding: 60,
      duration: 1200,
    });
  }, [focusBounds, ready]);

  // Highlight the active route
  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.setPaintProperty("route-lines", "line-color", [
      "case", ["==", ["get", "id"], activeRouteId ?? -1], "#f2a982", "#e8814e",
    ]);
    map.current.setPaintProperty("route-lines", "line-width", [
      "case", ["==", ["get", "id"], activeRouteId ?? -1], 4, 2.5,
    ]);
  }, [activeRouteId, ready]);

  return <div ref={mapContainer} className="h-full w-full" />;
}

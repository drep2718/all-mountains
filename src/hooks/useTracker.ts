"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptPoint,
  computeStats,
  distanceToTrailM,
  OFF_ROUTE_M,
  type TrackPoint,
  type TrackStats,
} from "@/lib/track";
import {
  clearLive,
  loadLive,
  saveLive,
  type LiveTrack,
} from "@/lib/trackStore";

export type TrackerStatus = "idle" | "recording" | "paused";
export type GpsError =
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "timeout" }
  | { kind: "unsupported" }
  | null;

const EMPTY_STATS: TrackStats = {
  distanceKm: 0, movingSeconds: 0, elapsedSeconds: 0, ascentM: 0,
  descentM: 0, currentSpeedKmh: 0, avgPaceMinPerKm: null, lastEle: null,
};

interface Options {
  /** Trail polyline ([lng,lat][] per line) to warn against wandering off. */
  trailLines?: number[][][];
  routeId?: number | null;
  routeName?: string | null;
}

export function useTracker({ trailLines, routeId = null, routeName = null }: Options = {}) {
  const [status, setStatus] = useState<TrackerStatus>("idle");
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [stats, setStats] = useState<TrackStats>(EMPTY_STATS);
  const [error, setError] = useState<GpsError>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [offRouteM, setOffRouteM] = useState<number | null>(null);
  const [recovered, setRecovered] = useState(false);

  const watchId = useRef<number | null>(null);
  const meta = useRef<{ startedAt: number; pausedMs: number; pausedAt: number | null }>({
    startedAt: 0, pausedMs: 0, pausedAt: null,
  });
  // Status inside the geolocation callback must be read from a ref — the
  // callback closes over its creation-time state otherwise. Written in an
  // effect, never during render.
  const statusRef = useRef<TrackerStatus>("idle");
  const linesRef = useRef<number[][][] | undefined>(trailLines);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { linesRef.current = trailLines; }, [trailLines]);

  // Recover an interrupted recording (backgrounded tab, crash, reload).
  // Reading localStorage can only happen on the client, so this runs once
  // after mount and hands the restored track to React in one batch.
  useEffect(() => {
    const live = loadLive();
    if (!live || live.points.length === 0) return;
    meta.current = {
      startedAt: live.startedAt,
      pausedMs: live.pausedMs,
      pausedAt: live.pausedAt,
    };
    /* eslint-disable react-hooks/set-state-in-effect --
       Restoring client-only localStorage state after mount. There is no server
       snapshot of an in-progress recording, so this cannot be an initializer. */
    setPoints(live.points);
    setStats(computeStats(live.points, live.pausedMs));
    setStatus("paused"); // never silently resume GPS without the user asking
    setRecovered(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const persist = useCallback((pts: TrackPoint[]) => {
    const live: LiveTrack = {
      points: pts,
      startedAt: meta.current.startedAt,
      pausedMs: meta.current.pausedMs,
      pausedAt: meta.current.pausedAt,
      routeId,
      routeName,
    };
    saveLive(live);
  }, [routeId, routeName]);

  const onFix = useCallback((pos: GeolocationPosition) => {
    if (statusRef.current !== "recording") return;
    setError(null);
    setAccuracy(pos.coords.accuracy ?? null);

    const next: TrackPoint = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      ele: pos.coords.altitude ?? null,
      t: pos.timestamp || Date.now(),
      acc: pos.coords.accuracy ?? null,
    };

    // Off-route distance uses every fix, even ones too jittery to record,
    // because a safety warning should not wait for a clean fix.
    if (linesRef.current?.length) {
      setOffRouteM(distanceToTrailM(next, linesRef.current));
    }

    setPoints((prev) => {
      const last = prev.length ? prev[prev.length - 1] : null;
      if (acceptPoint(last, next) === null) return prev;
      const updated = [...prev, next];
      setStats(computeStats(updated, meta.current.pausedMs));
      persist(updated); // write through on every accepted fix
      return updated;
    });
  }, [persist]);

  const onError = useCallback((err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) setError({ kind: "denied" });
    else if (err.code === err.POSITION_UNAVAILABLE) setError({ kind: "unavailable" });
    else setError({ kind: "timeout" });
  }, []);

  const beginWatch = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError({ kind: "unsupported" });
      return false;
    }
    if (watchId.current != null) return true;
    watchId.current = navigator.geolocation.watchPosition(onFix, onError, {
      enableHighAccuracy: true, // GPS chip, not wifi triangulation
      maximumAge: 0,
      timeout: 30000,
    });
    return true;
  }, [onFix, onError]);

  const endWatch = useCallback(() => {
    if (watchId.current != null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchId.current);
    }
    watchId.current = null;
  }, []);

  const start = useCallback(() => {
    if (!beginWatch()) return;
    meta.current = { startedAt: Date.now(), pausedMs: 0, pausedAt: null };
    setPoints([]);
    setStats(EMPTY_STATS);
    setRecovered(false);
    setStatus("recording");
  }, [beginWatch]);

  const pause = useCallback(() => {
    meta.current.pausedAt = Date.now();
    endWatch();
    setStatus("paused");
  }, [endWatch]);

  const resume = useCallback(() => {
    if (!beginWatch()) return;
    if (meta.current.pausedAt) {
      meta.current.pausedMs += Date.now() - meta.current.pausedAt;
      meta.current.pausedAt = null;
    }
    if (!meta.current.startedAt) meta.current.startedAt = Date.now();
    setRecovered(false);
    setStatus("recording");
  }, [beginWatch]);

  const stop = useCallback(() => {
    endWatch();
    setStatus("idle");
    const finished = {
      points,
      stats: computeStats(points, meta.current.pausedMs),
      startedAt: meta.current.startedAt,
    };
    clearLive();
    setPoints([]);
    setStats(EMPTY_STATS);
    setOffRouteM(null);
    meta.current = { startedAt: 0, pausedMs: 0, pausedAt: null };
    return finished;
  }, [endWatch, points]);

  const discard = useCallback(() => {
    endWatch();
    clearLive();
    setStatus("idle");
    setPoints([]);
    setStats(EMPTY_STATS);
    setOffRouteM(null);
    setRecovered(false);
    meta.current = { startedAt: 0, pausedMs: 0, pausedAt: null };
  }, [endWatch]);

  // Keep the clock honest while recording, even between GPS fixes.
  useEffect(() => {
    if (status !== "recording") return;
    const id = setInterval(() => {
      setStats((s) => ({
        ...s,
        elapsedSeconds: meta.current.startedAt
          ? Math.max(0, (Date.now() - meta.current.startedAt - meta.current.pausedMs) / 1000)
          : s.elapsedSeconds,
      }));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => endWatch, [endWatch]);

  return {
    status, points, stats, error, accuracy, recovered,
    offRouteM,
    isOffRoute: offRouteM != null && offRouteM > OFF_ROUTE_M,
    start, pause, resume, stop, discard,
  };
}

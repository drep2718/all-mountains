"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TrackerPanel from "@/components/TrackerPanel";
import { useTracker } from "@/hooks/useTracker";
import { toLines, computeStats } from "@/lib/track";
import { newId, saveActivity } from "@/lib/trackStore";
import type { Route } from "@/lib/types";

function RecordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const routeId = params.get("route");
  const [route, setRoute] = useState<Route | null>(null);

  useEffect(() => {
    if (!routeId) return;
    (async () => {
      const { data } = await createClient()
        .from("routes").select("*").eq("id", routeId).single();
      if (data) setRoute(data as Route);
    })();
  }, [routeId]);

  const trailLines = useMemo(
    () => (route ? toLines(route.poly) : undefined),
    [route]
  );

  const tracker = useTracker({
    trailLines,
    routeId: route?.id ?? null,
    routeName: route?.name ?? null,
  });

  const finish = useCallback(() => {
    const { points, stats, startedAt } = tracker.stop();
    if (points.length < 2) {
      router.push("/activities");
      return;
    }
    const final = stats ?? computeStats(points);
    const id = newId();
    saveActivity({
      id,
      name: route?.name ? `${route.name}` : "Hike",
      startedAt: startedAt || points[0].t,
      endedAt: points[points.length - 1].t,
      points,
      distanceKm: final.distanceKm,
      movingSeconds: final.movingSeconds,
      ascentM: final.ascentM,
      descentM: final.descentM,
      routeId: route?.id ?? null,
    });
    router.push(`/activities/${id}`);
  }, [tracker, route, router]);

  // A hiker who taps away mid-recording should be warned, not silently lose data.
  useEffect(() => {
    if (tracker.status !== "recording") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [tracker.status]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 md:pt-24">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">Record a hike</h1>
        <Link href="/activities" className="text-sm font-medium text-pine-600 hover:text-pine-700">
          My activities →
        </Link>
      </div>

      {route ? (
        <p className="mb-4 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-ink-muted">
          Following <span className="font-semibold text-ink">{route.name}</span>
          {route.distance_km != null && ` · ${route.distance_km.toFixed(1)} km`}
          {trailLines?.length ? " · off-trail warnings on" : ""}
        </p>
      ) : (
        <p className="mb-4 text-sm text-ink-muted">
          Free recording. Start from a trail page to get off-route warnings.
        </p>
      )}

      <TrackerPanel
        status={tracker.status}
        stats={tracker.stats}
        error={tracker.error}
        accuracy={tracker.accuracy}
        recovered={tracker.recovered}
        isOffRoute={tracker.isOffRoute}
        offRouteM={tracker.offRouteM}
        pointCount={tracker.points.length}
        onStart={tracker.start}
        onPause={tracker.pause}
        onResume={tracker.resume}
        onFinish={finish}
        onDiscard={tracker.discard}
      />

      <p className="mt-6 text-center text-xs text-ink-faint">
        Keep this screen open while hiking. Your track is saved to this device
        continuously, so it survives a reload or lost signal.
      </p>
    </div>
  );
}

export default function RecordPage() {
  return (
    <Suspense fallback={<div className="py-24 text-center text-ink-muted">Loading…</div>}>
      <RecordInner />
    </Suspense>
  );
}

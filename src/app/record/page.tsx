"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TrackerPanel from "@/components/TrackerPanel";
import { useTracker } from "@/hooks/useTracker";
import { computeStats } from "@/lib/track";
import { newId, saveActivity } from "@/lib/trackStore";
import { decodeSegments, type LngLat } from "@/lib/polyline";
import { getPeakDownload } from "@/lib/offline";
import { useLocalStore } from "@/hooks/useLocalStore";
import {
  buildCues,
  compassPoint,
  cumulative,
  formatDistanceM,
  guide,
  orientToSummit,
  type Cue,
  type Guidance,
} from "@/lib/navigation";
import { formatDuration, type Peak, type PeakRoute } from "@/lib/peak-types";
import type { RouteProfile } from "@/lib/terrain";

const NavMap = dynamic(() => import("@/components/NavMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-surface-2" />,
});

function RecordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const routeId = params.get("route");
  const peakSlug = params.get("peak");

  /**
   * Offline bundle first, network second.
   *
   * This is the one screen that has to work with no signal, so it must never
   * wait on a request that cannot succeed. A downloaded mountain carries its
   * peak and routes in the download index. That index is localStorage — an
   * external store — so it is subscribed to rather than copied into state in
   * an effect, which would both cascade a render and mismatch on hydration.
   */
  const readCached = useCallback(() => {
    if (!peakSlug) return null;
    return (
      (getPeakDownload(peakSlug)?.payload as { peak?: Peak; routes?: PeakRoute[] } | undefined) ??
      null
    );
  }, [peakSlug]);
  const cached = useLocalStore<{ peak?: Peak; routes?: PeakRoute[] } | null>(readCached, null);

  const [netPeak, setNetPeak] = useState<Peak | null>(null);
  const [netRoute, setNetRoute] = useState<PeakRoute | null>(null);

  // Network wins when it arrives; the cache is what makes the screen instant.
  const peak = netPeak ?? cached?.peak ?? null;
  const route =
    netRoute ??
    (routeId
      ? (cached?.routes?.find((x) => String(x.id) === routeId) ?? null)
      : (cached?.routes?.[0] ?? null));
  const source: "offline" | "network" | null = netPeak
    ? "network"
    : cached?.peak
      ? "offline"
      : null;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = createClient();
        if (routeId) {
          const { data } = await supabase.from("routes").select("*").eq("id", routeId).single();
          if (!cancelled && data) setNetRoute(data as PeakRoute);
        }
        const slug = peakSlug ?? null;
        if (slug) {
          const { data } = await supabase.from("peaks").select("*").eq("slug", slug).single();
          if (!cancelled && data) setNetPeak(data as Peak);
        }
      } catch {
        // Offline with nothing downloaded: the panel below says so.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeId, peakSlug]);

  // Oriented so "forward" means "towards the summit" whichever way OSM drew it.
  const navLine = useMemo<LngLat[]>(() => {
    if (!route) return [];
    const flat = decodeSegments(route.poly).flat();
    if (flat.length < 2) return [];
    return peak ? orientToSummit(flat, [peak.longitude, peak.latitude]) : flat;
  }, [route, peak]);

  const cum = useMemo(() => (navLine.length ? cumulative(navLine) : []), [navLine]);
  const cues = useMemo<Cue[]>(() => (navLine.length ? buildCues(navLine) : []), [navLine]);
  const trailLines = useMemo(() => (navLine.length ? [navLine] : undefined), [navLine]);

  const tracker = useTracker({
    trailLines,
    routeId: route?.id ?? null,
    routeName: route?.name ?? null,
  });

  const position = useMemo<LngLat | null>(() => {
    const p = tracker.points[tracker.points.length - 1];
    return p ? [p.lng, p.lat] : null;
  }, [tracker.points]);

  const trackLine = useMemo<LngLat[]>(
    () => tracker.points.map((p) => [p.lng, p.lat] as LngLat),
    [tracker.points]
  );

  // Measured off the terrain by NavMap; makes "climb left" real.
  const [profile, setProfile] = useState<RouteProfile | null>(null);
  const cuesWithTerrain = useMemo(
    () => (navLine.length ? buildCues(navLine, profile) : []),
    [navLine, profile]
  );

  const guidance = useMemo<Guidance | null>(() => {
    if (!position || !peak || navLine.length < 2) return null;
    return guide(position, navLine, [peak.longitude, peak.latitude], {
      cum,
      cues: cuesWithTerrain,
      profile,
      difficulty: peak.difficulty,
    });
  }, [position, peak, navLine, cum, cuesWithTerrain, profile]);

  // --- off-route haptics ---
  // Buzz on the transition only. A phone that vibrates every second until you
  // are back on the path gets put in a pocket, which defeats the warning.
  const wasOff = useRef(false);
  useEffect(() => {
    const off = !!tracker.isOffRoute;
    if (off && !wasOff.current && typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
    wasOff.current = off;
  }, [tracker.isOffRoute]);

  // --- summit detection ---
  const [summitPrompt, setSummitPrompt] = useState(false);
  const promptedRef = useRef(false);
  useEffect(() => {
    if (!guidance?.atSummit || promptedRef.current) return;
    promptedRef.current = true;
    setSummitPrompt(true);
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([120, 80, 120, 80, 320]);
    }
  }, [guidance?.atSummit]);

  // --- keep the screen awake while navigating ---
  useEffect(() => {
    if (tracker.status !== "recording") return;
    let lock: WakeLockSentinel | null = null;
    let released = false;
    const request = async () => {
      try {
        lock = await navigator.wakeLock?.request("screen");
      } catch {
        /* denied or unsupported — the hint below tells the user to keep it on */
      }
    };
    void request();
    // iOS drops the lock whenever the tab is hidden; take it again on return.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !released) void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [tracker.status]);

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
      name: peak?.name ? `${peak.name}` : (route?.name ?? "Hike"),
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
  }, [tracker, peak, route, router]);

  useEffect(() => {
    if (tracker.status !== "recording") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [tracker.status]);

  const navigating = tracker.status === "recording" || tracker.status === "paused";

  return (
    <div className="mx-auto max-w-2xl px-4 pb-28 pt-6 md:pt-20">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold text-ink">
            {peak ? peak.name : "Record a hike"}
          </h1>
          {route && (
            <p className="truncate text-sm text-ink-muted">
              {route.name ?? "Unnamed path"}
              {source === "offline" && " · offline copy"}
            </p>
          )}
        </div>
        <Link href="/activities" className="shrink-0 text-sm font-medium text-pine-600">
          Activities →
        </Link>
      </div>

      {/* Off-route banner, above everything. */}
      {tracker.isOffRoute && (
        <div
          role="alert"
          className="mb-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3"
        >
          <p className="text-sm font-bold text-red-900">
            Off route — {Math.round(tracker.offRouteM ?? 0)} m from the path
          </p>
          <p className="mt-0.5 text-sm text-red-900/80">
            Head back the way you came until the line turns yellow again.
          </p>
        </div>
      )}

      {summitPrompt && peak && (
        <div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-bold text-amber-900">
            You&apos;re on top of {peak.name}.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              href={`/peaks/${peak.slug}`}
              className="rounded-lg bg-pine-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Log this summit
            </Link>
            <button
              type="button"
              onClick={() => setSummitPrompt(false)}
              className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-900"
            >
              Later
            </button>
          </div>
        </div>
      )}

      {navLine.length > 1 && (
        <NavMap
          routeLine={navLine}
          summit={peak ? [peak.longitude, peak.latitude] : navLine[navLine.length - 1]}
          position={position}
          track={trackLine}
          offRoute={!!tracker.isOffRoute}
          onProfile={setProfile}
          className="mb-3 h-64 sm:h-80"
        />
      )}

      {/* Guidance */}
      {guidance && (
        <div className="mb-3 rounded-2xl border border-border bg-surface p-4">
          {guidance.nextCue && (
            <div className="mb-3 flex items-center gap-3 border-b border-border pb-3">
              <span className="text-2xl" aria-hidden>
                {guidance.nextCue.kind === "summit"
                  ? "⛰"
                  : guidance.nextCue.kind === "steep"
                    ? "⛰↗"
                    : guidance.nextCue.turn === "left"
                      ? "↰"
                      : "↱"}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-ink">{guidance.nextCue.text}</p>
                <p className="text-sm text-ink-muted">
                  in {formatDistanceM(guidance.nextCue.inM)}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "To summit", value: formatDistanceM(guidance.remainingM) },
              {
                label: "Climb left",
                value:
                  guidance.remainingAscentM != null
                    ? `${guidance.remainingAscentM.toLocaleString()} m`
                    : "—",
              },
              {
                label: "Time left",
                value: guidance.etaMinutes != null ? formatDuration(guidance.etaMinutes) : "—",
              },
              {
                label: "Bearing",
                value: `${compassPoint(guidance.bearingToSummit)} ${Math.round(guidance.bearingToSummit)}°`,
              },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-[11px] text-ink-faint">{s.label}</div>
                <div className="font-mono text-sm font-semibold text-ink">{s.value}</div>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-ground">
              <div
                className="h-full rounded-full bg-pine-600 transition-all"
                style={{ width: `${Math.round(guidance.progress * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">
              {Math.round(guidance.progress * 100)}% along the route
            </p>
          </div>
        </div>
      )}

      {!route && (
        <p className="mb-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-ink-muted">
          Free recording — no route selected. Start from a peak to get guidance and
          off-route warnings.
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

      <p className="mt-5 text-center text-xs leading-relaxed text-ink-faint">
        {navigating
          ? "Keep this screen on — a browser cannot track you in the background. Your track is saved to this device on every fix, so it survives a reload or lost signal."
          : "Your track is saved to this device continuously, so it survives a reload or lost signal."}
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

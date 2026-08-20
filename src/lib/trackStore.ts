// Local-first persistence for recorded activities.
//
// Everything is written to localStorage FIRST and kept there. A hike is often
// recorded with no signal at all, so the device — not the network — is the
// source of truth. Cloud sync is best-effort on top of that.

import type { TrackPoint } from "@/lib/track";

const LIVE_KEY = "am.track.live";      // in-progress recording (crash recovery)
const LIST_KEY = "am.track.activities"; // completed activities

export interface LiveTrack {
  points: TrackPoint[];
  startedAt: number;
  pausedMs: number;
  pausedAt: number | null;
  routeId: number | null;
  routeName: string | null;
}

export interface Activity {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  points: TrackPoint[];
  distanceKm: number;
  movingSeconds: number;
  ascentM: number;
  descentM: number;
  routeId: number | null;
  synced?: boolean;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded mid-hike must never crash the recorder.
    return false;
  }
}

// --- In-progress track ------------------------------------------------------

export function saveLive(track: LiveTrack): boolean {
  return write(LIVE_KEY, track);
}

export function loadLive(): LiveTrack | null {
  const t = read<LiveTrack | null>(LIVE_KEY, null);
  if (!t || !Array.isArray(t.points)) return null;
  return t;
}

export function clearLive(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LIVE_KEY);
  } catch {
    /* ignore */
  }
}

// --- Completed activities ---------------------------------------------------

export function listActivities(): Activity[] {
  return read<Activity[]>(LIST_KEY, []).sort((a, b) => b.startedAt - a.startedAt);
}

export function getActivity(id: string): Activity | null {
  return listActivities().find((a) => a.id === id) ?? null;
}

export function saveActivity(a: Activity): void {
  const all = read<Activity[]>(LIST_KEY, []);
  const next = [a, ...all.filter((x) => x.id !== a.id)];
  write(LIST_KEY, next);
}

export function deleteActivity(id: string): void {
  write(LIST_KEY, read<Activity[]>(LIST_KEY, []).filter((a) => a.id !== id));
}

export function newId(): string {
  return `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

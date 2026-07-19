"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Peak, SummitLog } from "@/lib/types";
import { getDifficulty, getDifficultyColor } from "@/lib/types";
import { peakImageUrl, hasRealPhoto } from "@/lib/peakImage";
import { reverseGeocode, type PlaceContext } from "@/lib/geocode";

export default function PeakDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [peak, setPeak] = useState<Peak | null>(null);
  const [place, setPlace] = useState<PlaceContext | null>(null);
  const [logs, setLogs] = useState<SummitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLogForm, setShowLogForm] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const supabase = createClient();

  // Form state
  const [logDate, setLogDate] = useState(new Date().toISOString().split("T")[0]);
  const [logDuration, setLogDuration] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [logRating, setLogRating] = useState(0);
  const [logWeather, setLogWeather] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user?.id ?? null));
  }, []);

  useEffect(() => {
    async function fetch() {
      // Query the peak by ID — direct table query via Supabase client
      const { data: peakData } = await supabase
        .from("peaks")
        .select("*")
        .eq("id", id)
        .single();

      if (peakData) {
        const p = peakData as Peak;
        setPeak(p);
        // Resolve state / nearest town from coordinates (on-demand, cached by browser)
        reverseGeocode(p.latitude, p.longitude).then(setPlace).catch(() => {});
      }

      // Get summit logs for this peak
      const { data: logData } = await supabase
        .from("summit_logs")
        .select("*")
        .eq("peak_id", id)
        .eq("is_public", true)
        .order("summited_at", { ascending: false });

      if (logData) setLogs(logData as SummitLog[]);
      setLoading(false);
    }
    fetch();
  }, [id]);

  const handleSubmitLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !peak) return;
    setSubmitting(true);

    // Insert a new summit log — this goes through RLS which checks auth.uid() = user_id
    const { error } = await supabase.from("summit_logs").insert({
      user_id: user,
      peak_id: peak.id,
      summited_at: logDate,
      duration_minutes: logDuration ? parseInt(logDuration) : null,
      notes: logNotes || null,
      rating: logRating || null,
      weather: logWeather || null,
    });

    if (!error) {
      setShowLogForm(false);
      // Refresh logs
      const { data } = await supabase
        .from("summit_logs")
        .select("*")
        .eq("peak_id", peak.id)
        .eq("is_public", true)
        .order("summited_at", { ascending: false });
      if (data) setLogs(data as SummitLog[]);
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-alpine-500" />
      </div>
    );
  }

  if (!peak) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Peak not found.
      </div>
    );
  }

  const difficulty = getDifficulty(peak.elevation);
  const diffColor = getDifficultyColor(difficulty);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="mb-6 flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-slate-200"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>

      {/* Hero */}
      <div className="relative mb-8 overflow-hidden rounded-2xl">
        {peakImageUrl(peak, 1200, 600) ? (
          <img
            src={peakImageUrl(peak, 1200, 600)!}
            alt={peak.name || "Peak"}
            className="h-72 w-full object-cover sm:h-96"
          />
        ) : (
          <div className="flex h-72 items-center justify-center bg-gradient-to-br from-slate-800 to-slate-700 sm:h-96">
            <span className="text-8xl opacity-20">⛰</span>
          </div>
        )}
        {!hasRealPhoto(peak) && (
          <span className="absolute right-3 top-3 rounded-full bg-ground/80 px-2.5 py-1 text-xs text-ink-muted backdrop-blur">
            🛰 Satellite view
          </span>
        )}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent p-6 pt-20">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${diffColor}`}>
              {difficulty}
            </span>
            {peak.is_iconic && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#e8b33a] px-3 py-1 text-xs font-bold text-[#3d2c00]">
                🥇 Iconic Summit
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            {peak.name || "Unnamed Peak"}
          </h1>
          <p className="mt-1 text-slate-300">
            {[place?.place, place?.region, place?.country ?? peak.country]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Elevation", value: peak.elevation ? `${peak.elevation.toLocaleString()} m` : "—" },
          { label: "Prominence", value: peak.prominence ? `${peak.prominence.toLocaleString()} m` : "—" },
          { label: "Elevation (ft)", value: peak.elevation ? `${Math.round(peak.elevation * 3.281).toLocaleString()} ft` : "—" },
          { label: "Difficulty", value: difficulty },
          { label: "State / Region", value: place?.region ?? "—" },
          { label: "Nearest town", value: place?.place ?? "—" },
          { label: "Coordinates", value: `${peak.latitude.toFixed(4)}, ${peak.longitude.toFixed(4)}` },
          { label: "Country", value: place?.country ?? peak.country ?? "—" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-surface p-4">
            <div className="text-xs text-ink-faint">{stat.label}</div>
            <div className="mt-1 font-mono text-sm font-semibold text-ink">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* View on the live map */}
      <Link
        href={`/explore?peak=${peak.id}`}
        className="mb-6 flex items-center justify-center gap-2 rounded-2xl border border-pine-600 bg-pine-600/10 py-3 text-sm font-semibold text-pine-300 transition-colors hover:bg-pine-600/20"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
        </svg>
        View on map
      </Link>

      {/* About (Wikipedia description) */}
      {peak.description && (
        <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-2 font-display text-lg font-bold text-ink">About {peak.name}</h2>
          <p className="text-sm leading-relaxed text-ink-muted">{peak.description}</p>
        </div>
      )}

      {/* Wikipedia link */}
      {peak.wikipedia_url && (
        <a
          href={peak.wikipedia_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-8 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-summit-400 transition-colors hover:border-slate-700"
        >
          <span>📖</span>
          Read more on Wikipedia →
        </a>
      )}

      {/* Log a summit */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-100">Summit Logs</h2>
          {user ? (
            <button
              onClick={() => setShowLogForm(!showLogForm)}
              className="rounded-lg bg-alpine-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-alpine-500"
            >
              {showLogForm ? "Cancel" : "+ Log Summit"}
            </button>
          ) : (
            <Link
              href="/login"
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
            >
              Sign in to log
            </Link>
          )}
        </div>

        {showLogForm && (
          <form
            onSubmit={handleSubmitLog}
            className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">Date</label>
                <input
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-alpine-500"
                  required
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">Duration (minutes)</label>
                <input
                  type="number"
                  value={logDuration}
                  onChange={(e) => setLogDuration(e.target.value)}
                  placeholder="180"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-alpine-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">Weather</label>
                <select
                  value={logWeather}
                  onChange={(e) => setLogWeather(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none"
                >
                  <option value="">Select...</option>
                  <option value="sunny">☀️ Sunny</option>
                  <option value="cloudy">☁️ Cloudy</option>
                  <option value="rainy">🌧️ Rainy</option>
                  <option value="snowy">🌨️ Snowy</option>
                  <option value="windy">💨 Windy</option>
                  <option value="foggy">🌫️ Foggy</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-slate-300">Rating</label>
                <div className="flex gap-1 pt-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setLogRating(star)}
                      className={`text-2xl transition-colors ${
                        star <= logRating ? "text-peak-500" : "text-slate-700"
                      }`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <label className="mb-1.5 block text-sm text-slate-300">Notes</label>
              <textarea
                value={logNotes}
                onChange={(e) => setLogNotes(e.target.value)}
                rows={3}
                placeholder="How was the climb?"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-alpine-500"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="mt-4 rounded-lg bg-alpine-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-alpine-500 disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save Summit Log"}
            </button>
          </form>
        )}
      </div>

      {/* Existing logs */}
      {logs.length > 0 ? (
        <div className="space-y-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className="rounded-xl border border-slate-800 bg-slate-900 p-4"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-200">
                  {new Date(log.summited_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </div>
                {log.rating && (
                  <div className="text-sm text-peak-500">
                    {"★".repeat(log.rating)}
                    {"★".repeat(5 - log.rating).split("").map((_, i) => (
                      <span key={i} className="text-slate-700">★</span>
                    ))}
                  </div>
                )}
              </div>
              {log.duration_minutes && (
                <div className="mt-1 text-sm text-slate-400">
                  {Math.floor(log.duration_minutes / 60)}h {log.duration_minutes % 60}m
                  {log.weather && ` · ${log.weather}`}
                </div>
              )}
              {log.notes && (
                <p className="mt-2 text-sm text-slate-300">{log.notes}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          No summit logs yet. Be the first to log this peak!
        </p>
      )}
    </div>
  );
}

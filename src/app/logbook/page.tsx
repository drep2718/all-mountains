"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { SummitLog, Peak } from "@/lib/types";

interface LogWithPeak extends SummitLog {
  peaks: Peak;
}

export default function LogbookPage() {
  const [logs, setLogs] = useState<LogWithPeak[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalSummits: 0,
    uniquePeaks: 0,
    totalElevation: 0,
    totalDuration: 0,
  });
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    async function fetch() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      // Query summit_logs and JOIN with peaks table to get peak details.
      // The "peaks(*)" syntax tells Supabase to follow the foreign key
      // and include all columns from the peaks table.
      const { data } = await supabase
        .from("summit_logs")
        .select("*, peaks(*)")
        .eq("user_id", user.id)
        .order("summited_at", { ascending: false });

      if (data) {
        const typedLogs = data as LogWithPeak[];
        setLogs(typedLogs);

        const uniquePeakIds = new Set(typedLogs.map((l) => l.peak_id));
        setStats({
          totalSummits: typedLogs.length,
          uniquePeaks: uniquePeakIds.size,
          totalElevation: typedLogs.reduce(
            (sum, l) => sum + (l.elevation_gain_m || l.peaks?.elevation || 0),
            0
          ),
          totalDuration: typedLogs.reduce(
            (sum, l) => sum + (l.duration_minutes || 0),
            0
          ),
        });
      }
      setLoading(false);
    }
    fetch();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-alpine-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-bold text-slate-100">Your Logbook</h1>
      <p className="mt-2 text-slate-400">Every summit you&apos;ve conquered</p>

      {/* Stats dashboard */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total Summits", value: stats.totalSummits, icon: "🏔️" },
          { label: "Unique Peaks", value: stats.uniquePeaks, icon: "⛰" },
          {
            label: "Elevation Gained",
            value: `${(stats.totalElevation / 1000).toFixed(1)}km`,
            icon: "📈",
          },
          {
            label: "Time on Trail",
            value: `${Math.floor(stats.totalDuration / 60)}h`,
            icon: "⏱",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-5"
          >
            <div className="text-2xl">{stat.icon}</div>
            <div className="mt-2 text-2xl font-bold text-slate-100">
              {stat.value}
            </div>
            <div className="mt-1 text-sm text-slate-400">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Log timeline */}
      <div className="mt-8">
        {logs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 py-20 text-center">
            <span className="text-5xl">📔</span>
            <p className="mt-4 text-lg text-slate-400">
              Your logbook is empty
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Find a peak and log your first summit!
            </p>
            <Link
              href="/explore"
              className="mt-6 inline-block rounded-lg bg-alpine-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-alpine-500"
            >
              Explore Peaks
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <Link
                key={log.id}
                href={`/peaks/${log.peak_id}`}
                className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700"
              >
                {/* Peak photo */}
                <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-slate-800">
                  {log.peaks?.photo_url ? (
                    <img
                      src={log.peaks.photo_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-2xl opacity-30">
                      ⛰
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-100 truncate">
                    {log.peaks?.name || "Unknown Peak"}
                  </div>
                  <div className="mt-0.5 text-sm text-slate-400">
                    {new Date(log.summited_at).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                    {log.duration_minutes &&
                      ` · ${Math.floor(log.duration_minutes / 60)}h ${log.duration_minutes % 60}m`}
                    {log.weather && ` · ${log.weather}`}
                  </div>
                  {log.notes && (
                    <p className="mt-1 text-sm text-slate-500 truncate">
                      {log.notes}
                    </p>
                  )}
                </div>

                {/* Rating + elevation */}
                <div className="flex-shrink-0 text-right">
                  {log.rating && (
                    <div className="text-sm text-peak-500">
                      {"★".repeat(log.rating)}
                    </div>
                  )}
                  {log.peaks?.elevation && (
                    <div className="mt-1 text-sm font-medium text-alpine-600">
                      {log.peaks.elevation.toLocaleString()}m
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

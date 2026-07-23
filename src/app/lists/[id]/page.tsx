"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchList, fetchListItems, removeItem } from "@/lib/lists";
import type { ListItem } from "@/lib/types";
import { getDifficulty, getDifficultyColor, DIFFICULTY_HEX, formatDuration, type Difficulty } from "@/lib/types";

export default function ListDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const listId = Number(id);

  const list = useQuery({ queryKey: ["list", listId], queryFn: () => fetchList(listId) });
  const items = useQuery({ queryKey: ["list-items", listId], queryFn: () => fetchListItems(listId) });

  const remove = useMutation({
    mutationFn: (it: ListItem) =>
      removeItem(listId, it.peak_id ? "peak" : "route", (it.peak_id ?? it.route_id)!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list-items", listId] });
      qc.invalidateQueries({ queryKey: ["my-lists"] });
    },
  });

  if (list.isLoading) return <div className="p-8 text-sm text-ink-faint">Loading…</div>;
  if (!list.data) return <div className="p-8 text-sm text-ink-muted">List not found.</div>;

  const rows = items.data ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <button
        onClick={() => router.push("/lists")}
        className="mb-6 flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        ← All lists
      </button>

      <h1 className="font-display text-3xl font-bold text-ink">{list.data.name}</h1>
      <p className="mb-6 mt-1 text-sm text-ink-muted">
        {rows.length} item{rows.length === 1 ? "" : "s"}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-ink-faint">
          Empty list. Add peaks or trails with “Save to list”.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {rows.map((it) => {
            const isPeak = !!it.peak_id;
            const p = it.peak;
            const r = it.route;
            const diff: Difficulty | null = isPeak
              ? p ? getDifficulty(p.elevation) : null
              : (r?.difficulty as Difficulty) || null;
            const href = isPeak ? `/peaks/${it.peak_id}` : `/routes/${it.route_id}`;
            const name = isPeak ? (p?.name || "Unnamed peak") : (r?.name || "Unnamed trail");
            return (
              <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className="h-9 w-1.5 flex-none rounded-full"
                  style={{ background: diff ? DIFFICULTY_HEX[diff] : "#8a8a80" }}
                />
                <Link href={href} className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{name}</div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {isPeak
                      ? `⛰ Peak${p?.elevation ? ` · ${p.elevation.toLocaleString()} m` : ""}`
                      : `🥾 Trail${r?.distance_km != null ? ` · ${r.distance_km.toFixed(1)} km` : ""}${r?.est_time_min ? ` · ${formatDuration(r.est_time_min)}` : ""}`}
                  </div>
                </Link>
                {diff && (
                  <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-medium ${getDifficultyColor(diff)}`}>
                    {diff}
                  </span>
                )}
                <button
                  onClick={() => remove.mutate(it)}
                  disabled={remove.isPending}
                  className="flex-none rounded-lg px-2 py-1 text-xs text-ink-faint transition-colors hover:text-diff-extreme disabled:opacity-50"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

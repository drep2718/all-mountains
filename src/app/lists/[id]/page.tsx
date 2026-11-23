"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchList,
  fetchListItems,
  removeItem,
  sortListItems,
  LIST_SORT_LABEL,
  type ListSort,
} from "@/lib/lists";
import type { ListItem } from "@/lib/lists";
import { useUrlState } from "@/lib/useUrlState";
import { DIFFICULTY_HEX, DIFFICULTY_LABEL, difficultyClasses } from "@/lib/peak-types";

export default function ListDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const listId = Number(id);
  const validId = Number.isSafeInteger(listId) && listId > 0;
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    const db = createClient();
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => subscription.unsubscribe();
  }, []);

  // In the URL like the other browse pages, so a sorted list survives the
  // back button and can be sent to someone in the order you meant.
  const { state, set } = useUrlState({ sort: "added" });
  const sort = state.sort as ListSort;

  const list = useQuery({ queryKey: ["list", listId], queryFn: () => fetchList(listId), enabled: validId });
  const items = useQuery({ queryKey: ["list-items", listId], queryFn: () => fetchListItems(listId), enabled: !!list.data });

  const remove = useMutation({
    mutationFn: (it: ListItem) => removeItem(listId, it.peak_slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list-items", listId] });
      qc.invalidateQueries({ queryKey: ["my-lists"] });
    },
  });

  if (list.error) return <div role="alert" className="p-8 text-sm text-diff-extreme">Couldn’t load this list. <button className="underline" onClick={() => void list.refetch()}>Retry</button></div>;
  if (list.isLoading) return <div className="p-8 text-sm text-ink-faint">Loading…</div>;
  if (!list.data) return <div className="p-8 text-sm text-ink-muted">List not found.</div>;

  // Sorted for display only — the stored order is left untouched, so
  // switching back to "Recently added" restores exactly what was built.
  const rows = sortListItems(items.data ?? [], sort);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <button
        onClick={() => router.push("/lists")}
        className="mb-6 flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        ← All lists
      </button>

      <h1 className="font-display text-3xl font-bold tracking-tight text-ink">{list.data.name}</h1>

      <div className="mb-6 mt-1 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {rows.length} item{rows.length === 1 ? "" : "s"}
        </p>

        {/* Hidden below two items: there is nothing to reorder. */}
        {rows.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="sr-only">Sort list</span>
            <select
              value={sort}
              onChange={(e) => set({ sort: e.target.value })}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors hover:border-border-bright focus:border-pine-500"
            >
              {(Object.keys(LIST_SORT_LABEL) as ListSort[]).map((key) => (
                <option key={key} value={key}>
                  {LIST_SORT_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {remove.error && <p role="alert" className="mb-4 text-sm text-diff-extreme">Couldn’t remove this mountain. Try again.</p>}
      {items.error ? (
        <div role="alert" className="p-4 text-sm text-diff-extreme">Couldn’t load the mountains in this list. <button className="underline" onClick={() => void items.refetch()}>Retry</button></div>
      ) : items.isLoading ? <p className="text-sm text-ink-muted">Loading mountains…</p> : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-ink-faint">
          Empty list. Add mountains with “Save to list”.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {rows.map((it) => {
            const p = it.peak;
            const diff = p?.difficulty ?? null;
            return (
              <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className="h-9 w-1.5 flex-none rounded-full"
                  style={{ background: diff ? DIFFICULTY_HEX[diff] : "var(--color-ink-faint)" }}
                />
                <Link href={`/peaks/${it.peak_slug}`} className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">
                    {p?.name ?? it.peak_slug}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted">
                    {p
                      ? [
                          `${p.elevation_m.toLocaleString()} m`,
                          p.range_name,
                          p.country,
                          p.route_count ? `${p.route_count} route${p.route_count === 1 ? "" : "s"}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : "—"}
                  </div>
                </Link>
                {diff && (
                  <span
                    className={`flex-none rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${difficultyClasses(diff)}`}
                  >
                    {DIFFICULTY_LABEL[diff]}
                  </span>
                )}
                {list.data?.user_id === userId && <button
                  onClick={() => remove.mutate(it)}
                  disabled={remove.isPending}
                  className="flex-none rounded-lg px-2 py-1 text-xs text-ink-faint transition-colors hover:text-diff-extreme disabled:opacity-50"
                  aria-label="Remove"
                >
                  ✕
                </button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

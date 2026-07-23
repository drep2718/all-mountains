"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { ListItemType } from "@/lib/types";
import {
  fetchMyLists,
  fetchListsContaining,
  addItem,
  removeItem,
  createList,
} from "@/lib/lists";

export default function SaveToListButton({
  itemType,
  itemId,
}: {
  itemType: ListItemType;
  itemId: number;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [newName, setNewName] = useState("");
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => setSignedIn(!!user));
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const lists = useQuery({ queryKey: ["my-lists"], queryFn: fetchMyLists, enabled: open });
  const containing = useQuery({
    queryKey: ["lists-containing", itemType, itemId],
    queryFn: () => fetchListsContaining(itemType, itemId),
    enabled: open,
  });
  const inLists = new Set(containing.data ?? []);
  const saved = inLists.size > 0;

  const toggle = useMutation({
    mutationFn: async (listId: number) => {
      if (inLists.has(listId)) await removeItem(listId, itemType, itemId);
      else await addItem(listId, itemType, itemId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists-containing", itemType, itemId] });
      qc.invalidateQueries({ queryKey: ["my-lists"] });
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const list = await createList(newName.trim());
      await addItem(list.id, itemType, itemId);
    },
    onSuccess: () => {
      setNewName("");
      qc.invalidateQueries({ queryKey: ["my-lists"] });
      qc.invalidateQueries({ queryKey: ["lists-containing", itemType, itemId] });
    },
  });

  if (signedIn === false) {
    return (
      <Link
        href="/login"
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-surface py-3 text-sm font-semibold text-ink-muted transition-colors hover:bg-ground"
      >
        ♡ Sign in to save
      </Link>
    );
  }

  return (
    <div className="relative" ref={popRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-center gap-2 rounded-2xl border py-3 text-sm font-semibold transition-colors ${
          saved
            ? "border-pine-600 bg-pine-600/10 text-pine-700 hover:bg-pine-600/20"
            : "border-border bg-surface text-ink hover:bg-ground"
        }`}
      >
        {saved ? "♥ Saved" : "♡ Save to list"}
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-2xl border border-border bg-surface p-3 shadow-xl">
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {lists.isLoading ? (
              <div className="px-2 py-3 text-sm text-ink-faint">Loading…</div>
            ) : (lists.data ?? []).length === 0 ? (
              <div className="px-2 py-3 text-sm text-ink-faint">No lists yet — create one below.</div>
            ) : (
              lists.data!.map((l) => (
                <button
                  key={l.id}
                  onClick={() => toggle.mutate(l.id)}
                  disabled={toggle.isPending}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-ink transition-colors hover:bg-ground disabled:opacity-50"
                >
                  <span
                    className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border ${
                      inLists.has(l.id) ? "border-pine-600 bg-pine-600 text-white" : "border-border"
                    }`}
                  >
                    {inLists.has(l.id) && "✓"}
                  </span>
                  <span className="truncate">{l.name}</span>
                  <span className="ml-auto text-xs text-ink-faint">{l.item_count ?? 0}</span>
                </button>
              ))
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create.mutate(); }}
            className="mt-2 flex gap-2 border-t border-border pt-2"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New list name"
              className="min-w-0 flex-1 rounded-lg border border-border bg-ground px-2.5 py-1.5 text-sm text-ink outline-none focus:border-pine-600"
            />
            <button
              type="submit"
              disabled={!newName.trim() || create.isPending}
              className="flex-none rounded-lg bg-pine-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-pine-700 disabled:opacity-50"
            >
              Add
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

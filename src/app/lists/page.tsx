"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { fetchMyLists, createList, deleteList } from "@/lib/lists";

export default function ListsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => setSignedIn(!!user));
    // React to the session hydrating/refreshing so a signed-in user is never
    // shown the signed-out state due to a first-paint timing race.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_e, session) => setSignedIn(!!session?.user)
    );
    return () => subscription.unsubscribe();
  }, []);

  const lists = useQuery({ queryKey: ["my-lists"], queryFn: fetchMyLists, enabled: !!signedIn });

  const create = useMutation({
    mutationFn: () => createList(newName.trim()),
    onSuccess: () => { setNewName(""); setError(null); qc.invalidateQueries({ queryKey: ["my-lists"] }); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't create the list."),
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteList(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-lists"] }),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't delete the list."),
  });

  // Still checking auth
  if (signedIn === null) return null;

  // Signed out — say so plainly instead of silently bouncing to /login
  if (signedIn === false) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <div className="mb-3 text-4xl">🗂️</div>
        <h1 className="font-display text-2xl font-bold text-ink">Sign in to build lists</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Lists save peaks and trails to your account so they sync across devices.
        </p>
        <button
          onClick={() => router.push("/login")}
          className="mt-6 rounded-xl bg-pine-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-pine-700"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 font-display text-3xl font-bold text-ink">Your lists</h1>
      <p className="mb-6 text-sm text-ink-muted">Save peaks and trails into custom collections.</p>

      <form
        onSubmit={(e) => { e.preventDefault(); if (newName.trim()) create.mutate(); }}
        className="mb-8 flex gap-2"
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. Colorado 14ers to climb"
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-pine-600"
        />
        <button
          type="submit"
          disabled={!newName.trim() || create.isPending}
          className="flex-none rounded-xl bg-pine-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-pine-700 disabled:opacity-50"
        >
          {create.isPending ? "Creating…" : "+ New list"}
        </button>
      </form>

      {error && (
        <div className="mb-6 rounded-xl border border-diff-extreme/40 bg-diff-extreme/10 px-4 py-3 text-sm text-diff-extreme">
          {error}
        </div>
      )}

      {lists.isLoading ? (
        <div className="text-sm text-ink-faint">Loading…</div>
      ) : (lists.data ?? []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-ink-faint">
          No lists yet. Create one above, or hit “Save to list” on any peak or trail.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {lists.data!.map((l) => (
            <div key={l.id} className="group relative rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-pine-600">
              <Link href={`/lists/${l.id}`} className="block">
                <div className="font-display text-lg font-bold text-ink">{l.name}</div>
                <div className="mt-1 text-sm text-ink-muted">
                  {l.item_count ?? 0} item{(l.item_count ?? 0) === 1 ? "" : "s"}
                  {l.is_public && " · public"}
                </div>
              </Link>
              <button
                onClick={() => { if (confirm(`Delete “${l.name}”?`)) remove.mutate(l.id); }}
                className="absolute right-3 top-3 rounded-lg px-2 py-1 text-xs text-ink-faint opacity-0 transition-opacity hover:text-diff-extreme group-hover:opacity-100"
                aria-label="Delete list"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

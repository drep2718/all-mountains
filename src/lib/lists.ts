import { createClient } from "@/lib/supabase/client";
import type { Peak } from "@/lib/peak-types";

/**
 * Saved lists of mountains.
 *
 * Peak-only now. A route belongs to a peak, so "save this trail" collapses
 * into "save this mountain" — and a list of mountains is what the app is for.
 * All helpers rely on RLS (user_id = auth.uid()).
 */

export interface PeakList {
  id: number;
  user_id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
  /** Virtual — count of list_items. */
  item_count?: number;
}

export interface ListItem {
  id: number;
  list_id: number;
  peak_slug: string;
  created_at: string;
  peak?: Peak | null;
}

export async function fetchMyLists(): Promise<PeakList[]> {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error("Sign in to view your lists.");
  const { data, error } = await supabase
    .from("peak_lists")
    .select("*, list_items(count)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((l: PeakList & { list_items?: { count: number }[] }) => ({
    ...l,
    item_count: l.list_items?.[0]?.count ?? 0,
  }));
}

export async function createList(
  name: string,
  isPublic = false,
  description?: string
): Promise<PeakList> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("peak_lists")
    .insert({ user_id: user.id, name, is_public: isPublic, description: description ?? null })
    .select()
    .single();
  if (error) throw error;
  return data as PeakList;
}

export async function deleteList(listId: number): Promise<void> {
  const { error } = await createClient().from("peak_lists").delete().eq("id", listId);
  if (error) throw error;
}

/** Which of my lists already contain this peak — for the checked state. */
export async function fetchListsContaining(peakSlug: string): Promise<number[]> {
  const { data, error } = await createClient()
    .from("list_items")
    .select("list_id")
    .eq("peak_slug", peakSlug);
  if (error) throw error;
  return (data ?? []).map((r: { list_id: number }) => r.list_id);
}

export async function addItem(listId: number, peakSlug: string): Promise<void> {
  const { error } = await createClient()
    .from("list_items")
    .insert({ list_id: listId, peak_slug: peakSlug });
  // 23505 is the unique violation — already in the list, which is not an error.
  if (error && error.code !== "23505") throw error;
}

export async function removeItem(listId: number, peakSlug: string): Promise<void> {
  const { error } = await createClient()
    .from("list_items")
    .delete()
    .eq("list_id", listId)
    .eq("peak_slug", peakSlug);
  if (error) throw error;
}

export async function fetchList(listId: number): Promise<PeakList | null> {
  const { data, error } = await createClient()
    .from("peak_lists")
    .select("*")
    .eq("id", listId)
    .maybeSingle();
  if (error) throw error;
  return (data as PeakList) ?? null;
}

export async function fetchListItems(listId: number): Promise<ListItem[]> {
  const { data, error } = await createClient()
    .from("list_items")
    .select("*, peak:peaks(*)")
    .eq("list_id", listId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ListItem[];
}

import { createClient } from "@/lib/supabase/client";
import type { PeakList, ListItem, ListItemType } from "@/lib/types";

// All helpers use the browser client + rely on RLS (user_id = auth.uid()).

export async function fetchMyLists(): Promise<PeakList[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("peak_lists")
    .select("*, list_items(count)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((l: PeakList & { list_items?: { count: number }[] }) => ({
    ...l,
    item_count: l.list_items?.[0]?.count ?? 0,
  }));
}

export async function createList(name: string, isPublic = false): Promise<PeakList> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("peak_lists")
    .insert({ user_id: user.id, name, is_public: isPublic })
    .select()
    .single();
  if (error) throw error;
  return data as PeakList;
}

export async function deleteList(listId: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("peak_lists").delete().eq("id", listId);
  if (error) throw error;
}

/** The list_ids that already contain a given peak/route (to show checked state). */
export async function fetchListsContaining(
  type: ListItemType,
  itemId: number
): Promise<number[]> {
  const supabase = createClient();
  const col = type === "peak" ? "peak_id" : "route_id";
  const { data, error } = await supabase
    .from("list_items")
    .select("list_id")
    .eq(col, itemId);
  if (error) throw error;
  return (data ?? []).map((r: { list_id: number }) => r.list_id);
}

export async function addItem(listId: number, type: ListItemType, itemId: number) {
  const supabase = createClient();
  const row = type === "peak" ? { list_id: listId, peak_id: itemId } : { list_id: listId, route_id: itemId };
  const { error } = await supabase.from("list_items").insert(row as never);
  if (error && error.code !== "23505") throw error; // ignore duplicate
}

export async function removeItem(listId: number, type: ListItemType, itemId: number) {
  const supabase = createClient();
  const col = type === "peak" ? "peak_id" : "route_id";
  const { error } = await supabase
    .from("list_items")
    .delete()
    .eq("list_id", listId)
    .eq(col, itemId);
  if (error) throw error;
}

export async function fetchList(listId: number): Promise<PeakList | null> {
  const supabase = createClient();
  const { data } = await supabase.from("peak_lists").select("*").eq("id", listId).single();
  return (data as PeakList) ?? null;
}

export async function fetchListItems(listId: number): Promise<ListItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("list_items")
    .select("*, peak:peaks(*), route:routes(*)")
    .eq("list_id", listId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ListItem[];
}

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

// --- ordering --------------------------------------------------------------

/**
 * How a list can be ordered.
 *
 * "added" is the order the rows arrive in and stays the default: a list is
 * something the person built, and reordering it by default would throw away
 * the only arrangement they chose themselves.
 */
export type ListSort =
  | "added"
  | "highest"
  | "lowest"
  | "hardest"
  | "easiest"
  | "name";

export const LIST_SORT_LABEL: Record<ListSort, string> = {
  added: "Recently added",
  highest: "Highest first",
  lowest: "Lowest first",
  hardest: "Hardest first",
  easiest: "Easiest first",
  name: "Name A–Z",
};

/**
 * Grades in the order they actually get harder, which is not alphabetical —
 * sorting the strings would give hike, scramble, technical only by luck, and
 * any future grade would land wherever its first letter fell.
 */
const DIFFICULTY_RANK: Record<string, number> = {
  hike: 1,
  scramble: 2,
  technical: 3,
};

/**
 * Sort a list's rows without mutating the query cache's array.
 *
 * Rows whose peak failed to join, or whose peak has no grade, always sort
 * last whichever direction is chosen. Treating a missing value as zero would
 * put the least informative rows at the top of "Highest first", which reads
 * as a bug in the sort rather than as missing data.
 */
export function sortListItems(items: ListItem[], sort: ListSort): ListItem[] {
  if (sort === "added") return items;

  const byName = (a: ListItem, b: ListItem) =>
    (a.peak?.name ?? a.peak_slug).localeCompare(b.peak?.name ?? b.peak_slug);

  /** Missing values last, regardless of direction. */
  const nullsLast = (
    a: number | null | undefined,
    b: number | null | undefined,
    cmp: (x: number, y: number) => number
  ): number | null => {
    const aMissing = a == null;
    const bMissing = b == null;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    return cmp(a, b);
  };

  return [...items].sort((a, b) => {
    switch (sort) {
      case "highest":
      case "lowest": {
        const dir = sort === "highest" ? -1 : 1;
        const r = nullsLast(
          a.peak?.elevation_m,
          b.peak?.elevation_m,
          (x, y) => (x - y) * dir
        );
        return r !== 0 && r != null ? r : byName(a, b);
      }
      case "hardest":
      case "easiest": {
        const dir = sort === "hardest" ? -1 : 1;
        const r = nullsLast(
          a.peak?.difficulty ? DIFFICULTY_RANK[a.peak.difficulty] : null,
          b.peak?.difficulty ? DIFFICULTY_RANK[b.peak.difficulty] : null,
          (x, y) => (x - y) * dir
        );
        if (r !== 0 && r != null) return r;
        // Within a grade, break the tie by height in the same direction as
        // the grade itself. Two technical peaks under "hardest" should put
        // the bigger one first; two walk-ups under "easiest" should put the
        // smaller one first. Tie-breaking one way for both made "Easiest
        // first" open on Mount Whitney, the highest peak in the list.
        const byHeight = nullsLast(
          a.peak?.elevation_m,
          b.peak?.elevation_m,
          (x, y) => (x - y) * dir
        );
        return byHeight !== 0 && byHeight != null ? byHeight : byName(a, b);
      }
      case "name":
        return byName(a, b);
      default:
        return 0;
    }
  });
}

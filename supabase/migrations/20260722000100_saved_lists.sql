-- Saved lists: run ONCE in the Supabase SQL Editor (this project has no migration tooling).
-- Reuses the existing peak_lists table as the list container, and adds a polymorphic
-- list_items table that can hold BOTH peaks and routes. Idempotent — safe to re-run.

-- 1. Items table -----------------------------------------------------------------
create table if not exists public.list_items (
  id         bigint generated always as identity primary key,
  list_id    bigint not null references public.peak_lists(id) on delete cascade,
  peak_id    bigint references public.peaks(id)  on delete cascade,
  route_id   bigint references public.routes(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- exactly one of peak_id / route_id is set
  constraint one_item_kind check (num_nonnulls(peak_id, route_id) = 1)
);
create unique index if not exists list_items_list_peak_uniq  on public.list_items(list_id, peak_id)  where peak_id  is not null;
create unique index if not exists list_items_list_route_uniq on public.list_items(list_id, route_id) where route_id is not null;
create index if not exists list_items_list_idx on public.list_items(list_id);

-- 2. RLS on peak_lists (owner writes; owner or anyone reads public) ---------------
alter table public.peak_lists enable row level security;
drop policy if exists peak_lists_select on public.peak_lists;
drop policy if exists peak_lists_insert on public.peak_lists;
drop policy if exists peak_lists_update on public.peak_lists;
drop policy if exists peak_lists_delete on public.peak_lists;
create policy peak_lists_select on public.peak_lists for select using (user_id = auth.uid() or is_public);
create policy peak_lists_insert on public.peak_lists for insert with check (user_id = auth.uid());
create policy peak_lists_update on public.peak_lists for update using (user_id = auth.uid());
create policy peak_lists_delete on public.peak_lists for delete using (user_id = auth.uid());

-- 3. RLS on list_items (scoped through the parent list's ownership) ---------------
alter table public.list_items enable row level security;
drop policy if exists list_items_select on public.list_items;
drop policy if exists list_items_insert on public.list_items;
drop policy if exists list_items_delete on public.list_items;
create policy list_items_select on public.list_items for select using (
  exists (select 1 from public.peak_lists l where l.id = list_id and (l.user_id = auth.uid() or l.is_public))
);
create policy list_items_insert on public.list_items for insert with check (
  exists (select 1 from public.peak_lists l where l.id = list_id and l.user_id = auth.uid())
);
create policy list_items_delete on public.list_items for delete using (
  exists (select 1 from public.peak_lists l where l.id = list_id and l.user_id = auth.uid())
);

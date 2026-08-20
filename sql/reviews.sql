-- ============================================================================
-- REVIEWS & RATINGS — run ONCE in the Supabase SQL editor. Idempotent.
--
-- Gives trails and peaks the star ratings, written reviews and trail-condition
-- reports AllTrails is built around. One review per user per trail/peak.
-- ============================================================================

create table if not exists public.reviews (
  id          bigint generated always as identity primary key,
  user_id     uuid   not null references auth.users(id) on delete cascade,
  route_id    bigint references public.routes(id) on delete cascade,
  peak_id     bigint references public.peaks(id)  on delete cascade,
  rating      int    not null check (rating between 1 and 5),
  body        text,
  -- Free-form trail conditions, e.g. muddy / snow / overgrown / icy.
  conditions  text[],
  hiked_on    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- exactly one subject
  constraint one_subject check (num_nonnulls(route_id, peak_id) = 1)
);

-- One review per user per subject.
create unique index if not exists reviews_user_route_uniq
  on public.reviews (user_id, route_id) where route_id is not null;
create unique index if not exists reviews_user_peak_uniq
  on public.reviews (user_id, peak_id)  where peak_id  is not null;

-- Lookups when rendering a trail or peak page.
create index if not exists reviews_route_idx on public.reviews (route_id) where route_id is not null;
create index if not exists reviews_peak_idx  on public.reviews (peak_id)  where peak_id  is not null;

-- --- RLS: anyone can read, only the author can write ------------------------
alter table public.reviews enable row level security;

drop policy if exists reviews_select on public.reviews;
drop policy if exists reviews_insert on public.reviews;
drop policy if exists reviews_update on public.reviews;
drop policy if exists reviews_delete on public.reviews;

create policy reviews_select on public.reviews for select using (true);
create policy reviews_insert on public.reviews for insert with check (user_id = auth.uid());
create policy reviews_update on public.reviews for update using (user_id = auth.uid());
create policy reviews_delete on public.reviews for delete using (user_id = auth.uid());

-- --- Aggregate ratings ------------------------------------------------------
-- A view so a trail card can show "4.6 (128)" without pulling every review.
create or replace view public.route_ratings as
  select route_id,
         round(avg(rating)::numeric, 2) as avg_rating,
         count(*)                       as review_count
  from public.reviews
  where route_id is not null
  group by route_id;

create or replace view public.peak_ratings as
  select peak_id,
         round(avg(rating)::numeric, 2) as avg_rating,
         count(*)                       as review_count
  from public.reviews
  where peak_id is not null
  group by peak_id;

grant select on public.route_ratings to anon, authenticated;
grant select on public.peak_ratings  to anon, authenticated;

-- Keep updated_at honest on edits.
create or replace function public.touch_review() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists reviews_touch on public.reviews;
create trigger reviews_touch before update on public.reviews
  for each row execute function public.touch_review();

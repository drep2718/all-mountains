-- SummitMind community trip reports. Apply via `supabase db push` per supabase/README.md.
-- Idempotent — safe to re-run.

-- 1. Reports table ----------------------------------------------------------------
-- lat/lon stored directly (not PostGIS) since tools/tripReports.ts does a simple
-- bounding-box prefilter — revisit if/when this needs real radius queries like peaks does.
create table if not exists public.trip_reports (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  lat        double precision not null,
  lon        double precision not null,
  body       text not null check (char_length(body) between 1 and 2000),
  posted_at  timestamptz not null default now(),
  is_hidden  boolean not null default false
);
create index if not exists trip_reports_location_idx on public.trip_reports(lat, lon);
create index if not exists trip_reports_posted_at_idx on public.trip_reports(posted_at desc);

-- 2. Flags — one per user per report; a report with several distinct flaggers is a
-- moderation signal (surfacing/actioning that is an app-level decision, not automated here).
create table if not exists public.trip_report_flags (
  report_id  bigint not null references public.trip_reports(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  flagged_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

-- 3. RLS on trip_reports (anyone reads non-hidden; only the author writes) --------
alter table public.trip_reports enable row level security;
drop policy if exists trip_reports_select on public.trip_reports;
drop policy if exists trip_reports_insert on public.trip_reports;
drop policy if exists trip_reports_delete on public.trip_reports;
create policy trip_reports_select on public.trip_reports for select using (is_hidden = false or user_id = auth.uid());
create policy trip_reports_insert on public.trip_reports for insert with check (user_id = auth.uid());
create policy trip_reports_delete on public.trip_reports for delete using (user_id = auth.uid());

-- 4. RLS on trip_report_flags (any signed-in user flags; no reading someone else's flag list) --
alter table public.trip_report_flags enable row level security;
drop policy if exists trip_report_flags_insert on public.trip_report_flags;
create policy trip_report_flags_insert on public.trip_report_flags for insert with check (user_id = auth.uid());

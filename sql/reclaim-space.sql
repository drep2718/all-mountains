-- ============================================================================
-- RECLAIM DISK SPACE — run ONLY once the database accepts connections again.
--
-- WHY THIS EXISTS
-- The overnight import took `routes` from ~2,500 rows to ~139,000. Each row
-- carries a full GeoJSON `geometry`, a PostGIS `path` geography derived from
-- it, and a `tags` jsonb blob. Long trails hold thousands of coordinates, so
-- the table is far larger than the row count suggests. That filled the disk,
-- and Postgres will not start on a full volume.
--
-- ORDER OF OPERATIONS
--   1. Raise the disk size in the dashboard FIRST. Postgres must be running
--      before it can delete anything, and DELETE itself needs WAL space.
--   2. Then run this, top to bottom, one section at a time.
-- ============================================================================

-- --- 0. Measure before doing anything --------------------------------------
-- Run this alone first. If routes is only a few hundred MB, disk is not the
-- problem and you should stop and look elsewhere rather than deleting data.
select
  relname                                          as table_name,
  pg_size_pretty(pg_total_relation_size(c.oid))    as total,
  pg_size_pretty(pg_relation_size(c.oid))          as heap,
  pg_size_pretty(pg_indexes_size(c.oid))           as indexes,
  n_live_tup                                       as approx_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;

select pg_size_pretty(pg_database_size(current_database())) as database_total;


-- --- 1. Drop the trail ways, keep the curated routes ------------------------
-- Ways were imported with a NEGATED osm_id; hiking route relations keep a
-- positive one. The relations (~24k) are the named, waymarked, genuinely
-- notable trails. The ways (~115k) are individual named paths — useful, but
-- they are the bulk of the storage and the first thing to shed.
--
-- Check the split before deleting:
select
  count(*) filter (where osm_id > 0) as relations_keep,
  count(*) filter (where osm_id < 0) as ways_delete
from public.routes;

-- Delete in batches so a single statement never exhausts WAL or hits the
-- statement timeout on a struggling instance. Re-run until it reports 0.
with doomed as (
  select id from public.routes where osm_id < 0 limit 5000
)
delete from public.routes r using doomed d where r.id = d.id;

-- Repeat the statement above until `DELETE 0`.


-- --- 2. Reclaim the space to the filesystem ---------------------------------
-- Plain DELETE only marks rows dead; the file keeps its size. VACUUM FULL
-- rewrites the table and returns space to the OS, but takes an ACCESS
-- EXCLUSIVE lock — the table is unreadable while it runs. Do it in a quiet
-- window, and only after the deletes above report 0.
vacuum full public.routes;
vacuum full public.route_peaks;
analyze public.routes;


-- --- 3. If you want the ways back later -------------------------------------
-- Re-run the importer against a bigger disk, and consider narrowing it:
--   npx tsx --env-file=.env.local scripts/import-trail-ways.ts US --min-km 2
-- A 2 km floor drops the short connector fragments that dominate the row
-- count while keeping the trails anyone would actually set out to walk.

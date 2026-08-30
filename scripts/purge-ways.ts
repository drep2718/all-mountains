/**
 * Delete every imported trail *way*, keeping the route relations.
 *
 * Ways carry a negated osm_id; relations keep a positive one. The relations are
 * clean — they always used an area filter, so their countries are right and
 * they contain no farm roads. The ways need redoing with the corrected query.
 *
 * Deletes in batches so no single statement is large enough to time out.
 *
 * Usage: npx tsx --env-file=.env.local scripts/purge-ways.ts [--yes]
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BATCH = 500;

async function count(filter: string): Promise<number> {
  const { count: n } = await supabase
    .from("routes")
    .select("id", { count: "exact", head: true })
    .or(filter);
  return n ?? 0;
}

async function main() {
  const yes = process.argv.includes("--yes");

  const { count: ways } = await supabase
    .from("routes").select("id", { count: "exact", head: true }).lt("osm_id", 0);
  const { count: relations } = await supabase
    .from("routes").select("id", { count: "exact", head: true }).gt("osm_id", 0);

  console.log(`\n  ways to delete    ${ways ?? 0}`);
  console.log(`  relations to keep ${relations ?? 0}\n`);

  if (!ways) { console.log("nothing to do"); return; }
  if (!yes) {
    console.log("Re-run with --yes to proceed.");
    return;
  }

  let deleted = 0;
  for (;;) {
    // Select a page of ids, then delete exactly those. Deleting by predicate
    // alone would rescan the table on every pass.
    const { data, error } = await supabase
      .from("routes").select("id").lt("osm_id", 0).limit(BATCH);
    if (error) { console.error(`\nselect: ${error.message}`); break; }

    const ids = (data ?? []).map((r: { id: number }) => r.id);
    if (ids.length === 0) break;

    const { error: delErr } = await supabase.from("routes").delete().in("id", ids);
    if (delErr) { console.error(`\ndelete: ${delErr.message}`); break; }

    deleted += ids.length;
    process.stdout.write(`\r  deleted ${deleted}/${ways}   `);
  }

  const { count: left } = await supabase
    .from("routes").select("id", { count: "exact", head: true }).lt("osm_id", 0);
  const { count: kept } = await supabase
    .from("routes").select("id", { count: "exact", head: true }).gt("osm_id", 0);

  console.log(`\n\n  ways remaining    ${left ?? 0}`);
  console.log(`  relations intact  ${kept ?? 0}`);
  console.log(`\n  Next: ./.loop/reimport-ways.sh`);
  void count;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

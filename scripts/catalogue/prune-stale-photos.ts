/**
 * Remove photo rows whose URL is no longer in the catalogue.
 *
 * `load-catalogue.ts` upserts on (peak_slug, url), which makes re-runs free
 * but means a row whose URL *changes* lands as a new row beside the old one
 * rather than replacing it. Repairing the Commons URLs rewrote all 5,628 of
 * them, so the database ended up holding both versions — 11,664 rows for
 * 6,036 photos, and every gallery showing each picture twice at two sizes.
 *
 * This deletes exactly the rows the catalogue no longer contains. It is
 * derived from the local files, so it can only ever remove something the
 * next load would not put back.
 *
 *   npx tsx --env-file=.env.local scripts/catalogue/prune-stale-photos.ts [--dry]
 *
 * Run it after load-catalogue.ts, never before: the new rows must exist
 * first, or a peak is briefly left with no photograph at all.
 */

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PHOTOS = path.join(ROOT, "data/catalogue/photos.ndjson");

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Delete in chunks; a URL list of 5,000 will not fit in one request. */
const CHUNK = 200;

async function main() {
  const dry = process.argv.includes("--dry");
  if (!URL_ || !KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exitCode = 1;
    return;
  }

  const text = await readFile(PHOTOS, "utf8");
  const wanted = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const p = JSON.parse(line) as { peak_slug: string; url: string };
    wanted.add(`${p.peak_slug}|${p.url}`);
  }
  console.log(`catalogue holds ${wanted.size} photos`);

  const db = createClient(URL_, KEY, { auth: { persistSession: false } });

  // Page through the table; the row count is well past PostgREST's default.
  const live: { id: number; peak_slug: string; url: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("peak_photos")
      .select("id,peak_slug,url")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    live.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`database holds ${live.length} photo rows`);

  const stale = live.filter((r) => !wanted.has(`${r.peak_slug}|${r.url}`));
  console.log(`stale (not in the catalogue): ${stale.length}`);

  // A peak must not be left with nothing. If every row for some peak is
  // stale, the new rows never loaded and deleting would blank its gallery.
  const keptBy = new Map<string, number>();
  for (const r of live) {
    if (wanted.has(`${r.peak_slug}|${r.url}`)) keptBy.set(r.peak_slug, (keptBy.get(r.peak_slug) ?? 0) + 1);
  }
  const wouldEmpty = [...new Set(stale.map((r) => r.peak_slug))].filter((s) => !keptBy.get(s));
  if (wouldEmpty.length) {
    console.error(
      `\nREFUSING: ${wouldEmpty.length} peaks would be left with no photo ` +
        `(${wouldEmpty.slice(0, 5).join(", ")}).\nRun load-catalogue.ts first.`
    );
    process.exitCode = 1;
    return;
  }

  if (!stale.length) {
    console.log("nothing to prune.");
    return;
  }
  console.log(`\nsample: ${stale[0].peak_slug} ${stale[0].url.slice(0, 90)}`);

  if (dry) {
    console.log("\n--dry: nothing deleted.");
    return;
  }

  let gone = 0;
  for (let i = 0; i < stale.length; i += CHUNK) {
    const ids = stale.slice(i, i + CHUNK).map((r) => r.id);
    const { error } = await db.from("peak_photos").delete().in("id", ids);
    if (error) throw new Error(`delete failed at ${i}: ${error.message}`);
    gone += ids.length;
    process.stdout.write(`\r  deleted ${gone}/${stale.length}   `);
  }

  const { count } = await db.from("peak_photos").select("*", { count: "exact", head: true });
  console.log(`\n\nphotos now in database: ${count}`);
}

main().catch((e) => {
  console.error("\n" + String(e));
  process.exitCode = 1;
});

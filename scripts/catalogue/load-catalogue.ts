/**
 * Load the verified local catalogue into Supabase. The ONLY script that writes
 * to the database.
 *
 * Idempotent: every write is an upsert on a natural key, so running it twice
 * changes nothing and a half-finished run is resumed by running it again.
 * That matters — the last database died from importing the same countries
 * three times and accumulating ~17,200 batch writes of dead tuples.
 *
 *   npx tsx --env-file=.env.local scripts/catalogue/load-catalogue.ts [--dry]
 *
 * Reads:  data/catalogue/{peaks,photos,routes}.ndjson
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "data/catalogue");

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Start here and halve on timeout rather than failing the run. */
const START_BATCH = 500;
const MIN_BATCH = 25;

async function readNdjson<T>(name: string): Promise<T[]> {
  try {
    const text = await readFile(path.join(DIR, name), "utf8");
    return text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

/**
 * Upsert in batches, shrinking the batch when the server complains about time.
 * Returns the number of rows written.
 */
async function upsertAll(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<number> {
  let size = START_BATCH;
  let i = 0;
  let written = 0;

  while (i < rows.length) {
    const slice = rows.slice(i, i + size);
    const { error } = await db.from(table).upsert(slice, { onConflict, ignoreDuplicates: false });

    if (error) {
      const timeoutish = /timeout|canceling statement|too large|57014|павло/i.test(error.message);
      if (timeoutish && size > MIN_BATCH) {
        size = Math.max(MIN_BATCH, Math.floor(size / 2));
        process.stdout.write(`\r  ${table}: batch → ${size} after "${error.message.slice(0, 50)}"   \n`);
        continue;
      }
      throw new Error(`${table} upsert failed at row ${i}: ${error.message}`);
    }

    i += slice.length;
    written += slice.length;
    process.stdout.write(`\r  ${table}: ${written}/${rows.length}   `);
  }
  process.stdout.write("\n");
  return written;
}

/**
 * Fail before writing anything if the schema is not the one we expect.
 * A previous run silently discarded 172 batches — every row — because the
 * table lacked a column the importer wrote, and nothing checked first.
 */
async function assertSchema(db: SupabaseClient): Promise<void> {
  const checks: [string, string][] = [
    ["peaks", "slug,name,elevation_m,prominence_m,summary,hero_photo_url"],
    ["peak_photos", "peak_slug,url,credit,license"],
    ["routes", "peak_slug,poly,distance_to_summit_m,is_summit_route"],
  ];
  for (const [table, cols] of checks) {
    const { error } = await db.from(table).select(cols).limit(1);
    if (error) {
      throw new Error(
        `schema check failed on "${table}" (${error.message}).\n` +
          `Run sql/peaks-first-schema.sql in the Supabase SQL editor first.`
      );
    }
  }
  console.log("✓ schema matches");
}

async function main() {
  const dry = process.argv.includes("--dry");

  const peaks = await readNdjson<Record<string, unknown>>("peaks.ndjson");
  const photos = await readNdjson<Record<string, unknown>>("photos.ndjson");
  const routes = await readNdjson<Record<string, unknown>>("routes.ndjson");

  console.log(
    `\ncatalogue on disk:  ${peaks.length} peaks · ${photos.length} photos · ${routes.length} routes`
  );
  if (!peaks.length) {
    console.error("no peaks.ndjson — run enrich-peaks.ts first");
    process.exitCode = 1;
    return;
  }

  // Map the enriched shape onto the table's columns. Fields the catalogue
  // carries for auditing (match_score, match_rejected, elevation_wikidata_m)
  // deliberately do not go to the database.
  const peakRows = peaks.map((p) => ({
    slug: p.id,
    name: p.name,
    country: p.country,
    continent: p.continent,
    region: p.region ?? null,
    elevation_m: p.elevation_m,
    latitude: p.latitude,
    longitude: p.longitude,
    category: p.category,
    difficulty: p.difficulty,
    prominence_m: p.prominence_m ?? null,
    isolation_km: p.isolation_km ?? null,
    range_name: p.range_name ?? null,
    summary: p.summary ?? null,
    wikipedia_url: p.wikipedia_url ?? null,
    wikidata_id: p.wikidata_id ?? null,
    commons_category: p.commons_category ?? null,
    hero_photo_url: p.hero_photo_url ?? null,
  }));

  // A photo for a peak that is not in the catalogue would violate the FK.
  const slugs = new Set(peakRows.map((p) => p.slug as string));
  const photoRows = photos.filter((ph) => slugs.has(ph.peak_slug as string));
  const routeRows = routes.filter((r) => slugs.has(r.peak_slug as string));
  const orphanPhotos = photos.length - photoRows.length;
  const orphanRoutes = routes.length - routeRows.length;
  if (orphanPhotos || orphanRoutes) {
    console.log(`  (skipping ${orphanPhotos} orphan photos, ${orphanRoutes} orphan routes)`);
  }

  const bytes =
    JSON.stringify(peakRows).length +
    JSON.stringify(photoRows).length +
    JSON.stringify(routeRows).length;
  console.log(`payload: ~${(bytes / 1_048_576).toFixed(1)} MB of JSON\n`);

  if (dry) {
    console.log("--dry: nothing written.");
    console.log("sample peak:", JSON.stringify(peakRows[0], null, 2).slice(0, 700));
    return;
  }

  if (!URL_ || !KEY) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Create the Supabase project, put the values in .env.local, then re-run with\n" +
        "  npx tsx --env-file=.env.local scripts/catalogue/load-catalogue.ts"
    );
    process.exitCode = 1;
    return;
  }

  const db = createClient(URL_, KEY, { auth: { persistSession: false } });
  await assertSchema(db);

  await upsertAll(db, "peaks", peakRows, "slug");
  if (photoRows.length) await upsertAll(db, "peak_photos", photoRows, "peak_slug,url");
  if (routeRows.length) await upsertAll(db, "routes", routeRows, "peak_slug,osm_id");

  const count = async (t: string) => {
    const { count: n } = await db.from(t).select("*", { count: "exact", head: true });
    return n ?? 0;
  };
  console.log(
    `\nin database: ${await count("peaks")} peaks · ${await count("peak_photos")} photos · ${await count("routes")} routes`
  );
  console.log("\nDone. Re-running this script is safe and changes nothing.");
}

main().catch((e) => {
  console.error("\n" + String(e));
  process.exitCode = 1;
});

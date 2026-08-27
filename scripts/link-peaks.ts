/**
 * Link routes to the peaks they pass near.
 *
 * The `link_route_peaks` DB function does the whole table in one statement,
 * which blows the statement timeout now that there are tens of thousands of
 * routes. This walks routes in id-ordered chunks and links each chunk using the
 * existing `peaks_in_bounds` RPC over the route's bounding box, so no single
 * query is large enough to time out.
 *
 * Usage: npx tsx --env-file=.env.local scripts/link-peaks.ts [--chunk 200]
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface RouteRow {
  id: number;
  bbox_min_lat: number; bbox_min_lng: number;
  bbox_max_lat: number; bbox_max_lng: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A peak counts as "on" a route when it sits within this many degrees of the
// route's bounding box (~1.1 km) — close enough to be the summit it serves.
const PAD = 0.01;

/** Bounds lookups in flight at once. Kept modest so the API stays responsive. */
const CONCURRENCY = 6;

/** Consecutive fetch failures before this job stops instead of retrying. */
const MAX_FAILURES = 6;

async function main() {
  const args = process.argv.slice(2);
  const ci = args.indexOf("--chunk");
  const CHUNK = ci >= 0 && args[ci + 1] ? parseInt(args[ci + 1], 10) : 200;

  // Resume from a known id so an interrupted run doesn't redo everything.
  const ai = args.indexOf("--after");
  let after = ai >= 0 && args[ai + 1] ? parseInt(args[ai + 1], 10) : 0;
  let processed = 0;
  let links = 0;
  let consecutiveFailures = 0;

  console.log(`\n🔗 Linking routes to peaks (chunk ${CHUNK})\n`);

  for (;;) {
    const { data, error } = await supabase
      .from("routes")
      .select("id,bbox_min_lat,bbox_min_lng,bbox_max_lat,bbox_max_lng")
      .gt("id", after)
      .order("id", { ascending: true })
      .limit(CHUNK);

    if (error) {
      consecutiveFailures++;
      console.error(`fetch error (${consecutiveFailures}/${MAX_FAILURES}): ${error.message}`);

      // Give up rather than retry forever. An earlier version looped every two
      // seconds with no ceiling; when the database went down it kept hammering
      // it for hours, which held the instance under load instead of letting it
      // recover. A dead database is a reason to stop, not to try harder.
      if (consecutiveFailures >= MAX_FAILURES) {
        console.error(
          `\n✗ Giving up after ${MAX_FAILURES} consecutive failures.` +
          `\n  The database is not answering. Fix it first, then re-run:` +
          `\n    npx tsx --env-file=.env.local scripts/link-peaks.ts --after ${after}\n`
        );
        process.exitCode = 1;
        return;
      }

      // Exponential backoff, capped — back off *harder* when it keeps failing.
      const wait = Math.min(60_000, 2000 * 2 ** (consecutiveFailures - 1));
      console.error(`  backing off ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    consecutiveFailures = 0;
    const routes = (data ?? []) as RouteRow[];
    if (routes.length === 0) break;

    const rows: { route_id: number; peak_id: number }[] = [];

    // One bounds lookup per route, a few in flight at a time. Serially this is
    // ~200 ms x 95k routes — many hours; the DB handles a small amount of
    // concurrency comfortably and cuts that to well under one.
    let cursor = 0;
    async function worker() {
      for (;;) {
        const r = routes[cursor++];
        if (!r) return;
        if (r.bbox_min_lat == null) continue;
        try {
          const { data: peaks } = await supabase.rpc("peaks_in_bounds", {
            min_lat: r.bbox_min_lat - PAD, min_lng: r.bbox_min_lng - PAD,
            max_lat: r.bbox_max_lat + PAD, max_lng: r.bbox_max_lng + PAD,
            min_elevation: 0, lim: 40,
          });
          for (const p of (peaks ?? []) as { id: number; name: string | null }[]) {
            if (!p.name) continue; // only named summits are worth surfacing
            rows.push({ route_id: r.id, peak_id: p.id });
          }
        } catch {
          /* skip this route rather than abandoning the chunk */
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    if (rows.length) {
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error: insErr } = await supabase
          .from("route_peaks")
          .upsert(batch, { onConflict: "route_id,peak_id", ignoreDuplicates: true });
        if (insErr && insErr.code !== "23505") {
          console.error(`  insert: ${insErr.message.slice(0, 80)}`);
        } else {
          links += batch.length;
        }
      }
    }

    after = routes[routes.length - 1].id;
    processed += routes.length;
    process.stdout.write(`\r  routes ${processed} · links ${links} · last id ${after}    `);
  }

  console.log(`\n\n✅ Linked ${links} route↔peak pairs across ${processed} routes.`);
}

main().catch(console.error);

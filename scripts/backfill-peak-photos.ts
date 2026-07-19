/**
 * Backfill real photos for peaks that have a Wikipedia article, via the
 * Wikipedia REST summary API (returns a lead image). Peaks without an article
 * keep the on-the-fly Mapbox satellite view in the app, so every peak still
 * has a visual.
 *
 * Usage: npx tsx --env-file=.env.local scripts/backfill-peak-photos.ts
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pull the article title out of a stored wikipedia_url
function titleFromUrl(url: string): string | null {
  const m = url.match(/\/wiki\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Returns both the lead image and the description extract in one API call.
async function fetchWikiInfo(title: string): Promise<{ photo: string | null; description: string | null }> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { "User-Agent": "AllMountains/1.0 (peak enrichment; aidendrepaniotis@gmail.com)" } }
    );
    if (!res.ok) return { photo: null, description: null };
    const data = await res.json();
    return {
      photo: data?.originalimage?.source || data?.thumbnail?.source || null,
      description: data?.extract || null,
    };
  } catch {
    return { photo: null, description: null };
  }
}

async function main() {
  console.log("\n📷 Peak photo backfill (Wikipedia)\n");

  let from = 0;
  const PAGE = 200;
  let updated = 0, checked = 0;

  for (;;) {
    // Peaks with a Wikipedia article still missing a photo OR a description
    const { data, error } = await supabase
      .from("peaks")
      .select("id, wikipedia_url, photo_url, description")
      .not("wikipedia_url", "is", null)
      .or("photo_url.is.null,description.is.null")
      .range(from, from + PAGE - 1);

    if (error) { console.error("Query error:", error.message); break; }
    if (!data || data.length === 0) break;

    for (const peak of data) {
      checked++;
      const title = peak.wikipedia_url ? titleFromUrl(peak.wikipedia_url) : null;
      if (!title) continue;

      const info = await fetchWikiInfo(title);
      const patch: { photo_url?: string; description?: string } = {};
      if (info.photo && !peak.photo_url) patch.photo_url = info.photo;
      if (info.description && !peak.description) patch.description = info.description;

      if (Object.keys(patch).length > 0) {
        const { error: upErr } = await supabase.from("peaks").update(patch).eq("id", peak.id);
        if (upErr) {
          if (/read-only|permission|disk|quota/i.test(upErr.message)) {
            console.error(`\n🛑 Writes rejected (${upErr.message}) — stopping.`);
            process.exit(2);
          }
        } else {
          updated++;
        }
      }
      if (checked % 25 === 0) process.stdout.write(`\r  checked ${checked}, enriched ${updated}`);
      await sleep(120); // be gentle with Wikipedia
    }
    from += PAGE;
  }

  console.log(`\n\n✅ Done. Enriched ${updated} peaks with photos + descriptions.`);
}

main().catch(console.error);

/**
 * SummitMind — Trail Context Ingestion Script
 *
 * Pulls guidebook notes / trip reports / route descriptions and upserts them
 * into Qdrant as embeddings, so retrieveContext.ts has something to search.
 * Same shape as scripts/import-routes.ts: a one-off/re-runnable data job, run
 * via tsx, not part of the Next.js app.
 *
 * Usage: npx tsx --env-file=.env.local scripts/summitmind/ingest-trail-context.ts
 *
 * Plumbing (Supabase read, Qdrant upsert) is done. The one thing genuinely
 * left to you: CHUNKING STRATEGY — how you split a long trip report or
 * guidebook entry into embeddable pieces matters as much as the retrieval
 * code itself. A chunk that's too big dilutes the embedding (the specific
 * detail you needed gets averaged away); too small and you lose the
 * surrounding context that made it meaningful. Common starting points:
 * fixed-size with overlap (~500 tokens, ~50 overlap), or split on natural
 * boundaries (paragraphs/sections) when your source data has them.
 *
 * RESOURCES:
 *   - Chunking strategies: https://www.pinecone.io/learn/chunking-strategies/
 *   - Qdrant upsert API: https://qdrant.tech/documentation/concepts/points/#upload-points
 */

import { createClient } from "@supabase/supabase-js";
import { embedText } from "../../src/lib/summitmind/clients/embeddings";
import { getQdrantClient, ensureCollection } from "../../src/lib/summitmind/clients/qdrant";
import { summitMindConfig } from "../../src/lib/summitmind/config";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// TODO: chunk(text) -> string[]. See the chunking-strategy note above.
function chunk(text: string): string[] {
  throw new Error("TODO: implement chunking — see file header comment");
}

async function main() {
  await ensureCollection();
  const qdrant = getQdrantClient();

  // TODO: pull your actual source rows. Placeholder query below assumes a
  // `peaks` table with a free-text `description` column — adjust to
  // whatever you're actually sourcing trail context from (peaks, routes,
  // or a new `trip_reports` table if you're ingesting community data too).
  const { data: peaks, error } = await supabase
    .from("peaks")
    .select("id, name, elevation_m, description")
    .not("description", "is", null);

  if (error) throw new Error(`Failed to read source rows: ${error.message}`);
  console.log(`Ingesting context for ${peaks?.length ?? 0} peaks...`);

  let point_id = 0;
  for (const peak of peaks ?? []) {
    const chunks = chunk(peak.description as string);

    for (const text of chunks) {
      const vector = await embedText(text, "document");
      await qdrant.upsert(summitMindConfig.qdrant.collection, {
        points: [
          {
            id: point_id++,
            vector,
            payload: {
              peakOrRouteName: peak.name,
              elevationM: peak.elevation_m,
              text,
              source: "All Mountains peak description",
              indexedAt: new Date().toISOString(),
            },
          },
        ],
      });
    }
  }

  console.log(`Done. Indexed ${point_id} chunks.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

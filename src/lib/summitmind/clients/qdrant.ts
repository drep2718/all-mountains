/**
 * Qdrant client — connection + collection bootstrap.
 *
 * This file is plumbing: connect, make sure the collection exists. The
 * actual retrieval query (graph/nodes/retrieveContext.ts) is where the
 * real thinking happens — what to embed, what filters to apply, how many
 * results, how to handle zero hits.
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { summitMindConfig } from "../config";

// Match your embedding model's output dimension. text-embedding-3-small = 1536,
// Voyage voyage-3 = 1024 — pick one in ingest-trail-context.ts and keep this in sync.
const VECTOR_SIZE = 1536;

let client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({ url: summitMindConfig.qdrant.url });
  }
  return client;
}

/** Idempotent — safe to call on every cold start. Run once manually before first ingest, too. */
export async function ensureCollection(): Promise<void> {
  const qdrant = getQdrantClient();
  const { collection } = summitMindConfig.qdrant;

  const existing = await qdrant.getCollections();
  const alreadyExists = existing.collections.some((c) => c.name === collection);
  if (alreadyExists) return;

  await qdrant.createCollection(collection, {
    vectors: { size: VECTOR_SIZE, distance: "Cosine" },
  });
}

export interface TrailContextPoint {
  id: string | number;
  score: number;
  payload: {
    peakOrRouteName: string;
    elevationM: number;
    text: string;
    source: string;
    sourceUrl?: string;
    indexedAt: string;
  };
}

// TODO: implement the actual similarity search. This is the retrieval half of
// RAG, and it's worth understanding what each parameter does rather than
// treating it as a black box:
//
//   - `vector`: the query embedding. You'll compute this in retrieveContext.ts
//     with the same embedding model used at ingest time (mismatch = garbage
//     results, this trips everyone up at least once).
//   - `limit`: how many candidates to return. Too low and you miss context,
//     too high and you drown the LLM's context window in noise — 3-8 is a
//     reasonable starting range for a synthesis task like this one.
//   - `scoreThreshold`: Qdrant will happily return your 8 *least bad* matches
//     even if none of them are actually relevant. A threshold is how you get
//     an honest "nothing relevant found" instead of a confident wrong answer.
//
// RESOURCES:
//   - Qdrant search API: https://qdrant.tech/documentation/concepts/search/
//   - Why cosine similarity for text embeddings: https://qdrant.tech/documentation/concepts/collections/#distance-metrics
export async function searchTrailContext(
  vector: number[],
  opts: { limit?: number; scoreThreshold?: number } = {}
): Promise<TrailContextPoint[]> {
  throw new Error("TODO: implement Qdrant similarity search — see comment above");
}

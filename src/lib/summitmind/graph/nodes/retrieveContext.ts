/**
 * Node: retrieveContext
 *
 * The "R" in RAG. Turns the user's query into an embedding, searches Qdrant,
 * and turns the top matches into a TrailContext the LLM can actually use.
 *
 * This is the node most tutorials get lazily wrong by skipping the "what if
 * nothing relevant comes back" case — don't skip it here. An empty or
 * low-confidence result should flow into TrailContext honestly (e.g. a
 * summary noting no strong match was found), not get papered over with
 * whatever the top result was regardless of score.
 *
 * Shape to follow:
 *   1. embedText(state.query, "query")  — note "query" not "document", Voyage
 *      embeds these differently and mixing them up degrades results.
 *   2. searchTrailContext(vector, { scoreThreshold: ... })
 *   3. Fold the returned points into one TrailContext.summary (concatenate?
 *      pick the single best? — your call, think about what the synthesize
 *      node downstream actually needs), and build a Source per point used.
 *
 * RESOURCES:
 *   - RAG failure modes worth knowing before you tune scoreThreshold: https://qdrant.tech/articles/what-is-rag-in-ai/
 */

import { embedText } from "../../clients/embeddings";
import { searchTrailContext } from "../../clients/qdrant";
import type { SummitMindStateType } from "../state";

export async function retrieveContext(
  state: SummitMindStateType
): Promise<Partial<SummitMindStateType>> {
  throw new Error("TODO: implement retrieveContext — see comment above");
}

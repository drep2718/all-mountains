/**
 * Node: synthesize — the last node, the one that produces SummitMindResponse.
 *
 * This is the grounding rule from the roadmap, made concrete: the prompt you
 * build here must instruct the model to answer ONLY from the gathered state
 * (trailContext, weather, hazard, experience) and their attached sources —
 * never from what it happens to "know" about the range. Concretely that
 * means the prompt should include the actual retrieved facts inline (not
 * just "here's some context, be careful"), and should explicitly forbid
 * stating a hazard level or number that isn't traceable to `state.sources`.
 *
 * Two things to branch on:
 *   - `state.ledWithWarning` — if true, the response structure should put
 *     the hazard/warning first, itinerary second. Not a stylistic nicety —
 *     this is the actual safety design from the roadmap.
 *   - `state.hazard.level === "unknown"` — say so plainly in the answer
 *     ("no official bulletin covers this area") rather than letting it read
 *     as confident silence on risk.
 *
 * Don't forget: append a Source-aware response, and this is also the natural
 * place to close out the Langfuse trace (see clients/langfuse.ts) with the
 * final input/output if you're using it.
 */

import { getLLMClient, DEFAULT_MODEL } from "../../clients/llm";
import type { SummitMindStateType } from "../state";
import type { SummitMindResponse } from "../../types";

export async function synthesize(
  state: SummitMindStateType
): Promise<Partial<SummitMindStateType> & { response?: SummitMindResponse }> {
  throw new Error("TODO: build the grounded prompt, call the LLM, return the final answer — see comment above");
}

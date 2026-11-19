/**
 * Node: assessRisk — the actual branch point of the graph.
 *
 * This file exports two things:
 *
 *   1. `assessRisk` — a normal node. Looks at everything gathered so far
 *      (hazard, weather, experience) and decides `ledWithWarning: true/false`.
 *      This is where you define what "risky enough to lead with a warning"
 *      actually means — there's no single right answer, but a defensible
 *      one might be: hazard.level is "considerable" or worse, OR hazard.level
 *      is "unknown" (no bulletin coverage) AND the terrain/season implies
 *      real consequence, OR the weather snapshot itself flags something
 *      severe regardless of the avalanche bulletin.
 *
 *   2. `routeAfterRiskAssessment` — the router LangGraph calls after this
 *      node to decide which node runs next. It reads the state this node
 *      just wrote and returns a node name. This is what "conditional edges"
 *      means concretely — see graph/index.ts for where it's wired in with
 *      `addConditionalEdges`.
 *
 *      Two valid destinations: `"checkExperience"` (normal path — go
 *      personalize, then synthesize) or `"synthesize"` directly (skip
 *      personalization when things look urgent — synthesize.ts reads
 *      `ledWithWarning` off state either way and adjusts how it frames the
 *      answer, so there's only one LLM-call node, not two near-duplicates).
 *
 * RESOURCES:
 *   - Conditional edges: https://langchain-ai.github.io/langgraphjs/concepts/low_level/#conditional-edges
 */

import type { SummitMindStateType } from "../state";

export async function assessRisk(
  state: SummitMindStateType
): Promise<Partial<SummitMindStateType>> {
  throw new Error("TODO: decide ledWithWarning from state.hazard / state.weather — see comment above");
}

export function routeAfterRiskAssessment(state: SummitMindStateType): "checkExperience" | "synthesize" {
  throw new Error("TODO: return the next node name based on state.ledWithWarning");
}

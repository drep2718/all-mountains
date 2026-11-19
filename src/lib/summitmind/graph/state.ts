/**
 * Graph state — the object that flows through every node.
 *
 * This is the shape, not the logic (that's what graph/index.ts and
 * graph/nodes/* are for), so it's written in full — same as types.ts.
 *
 * LangGraph.js state fields are declared via `Annotation`, each with a
 * `default` (what the field starts as) and a `reducer` (how a node's
 * returned partial update gets merged into the existing value — NOT
 * overwritten by default, which surprises people coming from plain
 * `useState`-style thinking). Most fields here just need "last write
 * wins" (the default reducer), but `sources` accumulates across every
 * node that cites something, so it needs an explicit concat reducer —
 * that's the one piece of actual behavior in this file, worth reading.
 *
 * RESOURCES:
 *   - LangGraph.js state & reducers: https://langchain-ai.github.io/langgraphjs/concepts/low_level/#state
 */

import { Annotation } from "@langchain/langgraph";
import type {
  CommunityTripReport,
  ExperienceProfile,
  HazardAssessment,
  Source,
  TrailContext,
  WeatherSnapshot,
} from "../types";

export const SummitMindState = Annotation.Root({
  // Input, set once when the graph is invoked.
  query: Annotation<string>,
  lat: Annotation<number>,
  lon: Annotation<number>,
  userId: Annotation<string | undefined>,

  // Filled in by nodes as the graph runs.
  trailContext: Annotation<TrailContext | undefined>,
  weather: Annotation<WeatherSnapshot | undefined>,
  hazard: Annotation<HazardAssessment | undefined>,
  experience: Annotation<ExperienceProfile | undefined>,
  communityReports: Annotation<CommunityTripReport[]>({
    reducer: (_existing, update) => update,
    default: () => [],
  }),

  // Accumulates — every node that used a source appends to this instead of
  // replacing it, which is why it needs its own reducer.
  sources: Annotation<Source[]>({
    reducer: (existing, update) => existing.concat(update),
    default: () => [],
  }),

  // Set by assessRisk.ts; read by the conditional edge to pick the next node.
  ledWithWarning: Annotation<boolean>({
    reducer: (_existing, update) => update,
    default: () => false,
  }),

  // Final output.
  answer: Annotation<string | undefined>,
});

export type SummitMindStateType = typeof SummitMindState.State;

/**
 * The graph itself — this file is where "using LangGraph" actually happens,
 * so it's deliberately left for you rather than pre-wired. Every node
 * function already exists (graph/nodes/*) and does what its name says;
 * your job is just the topology: which nodes exist to the graph, and which
 * edges connect them.
 *
 * ── HOW THE SYNTAX WORKS, worked on a toy graph first ──────────────────────
 *
 * Before touching the real SummitMind topology, here's every piece of the
 * API you need, on a fake 3-node graph that greets someone and then branches
 * on whether their name is "Aiden". This is runnable as-is if you want to
 * paste it into a scratch file and log the result — seeing it work on
 * something trivial makes the real graph much less mysterious.
 *
 *   import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
 *
 *   // 1. State schema — same idea as graph/state.ts, just smaller. Each
 *   //    node receives the FULL current state and returns a PARTIAL update;
 *   //    LangGraph merges it in for you using each field's reducer (default
 *   //    reducer = "overwrite with the new value").
 *   const ToyState = Annotation.Root({
 *     name: Annotation<string>,
 *     greeting: Annotation<string>,
 *   });
 *
 *   // 2. Nodes are plain functions: (state) => partial state update.
 *   //    Sync or async both work — LangGraph awaits either.
 *   function greet(state: typeof ToyState.State) {
 *     return { greeting: `Hello, ${state.name}!` };
 *   }
 *   function specialCase(state: typeof ToyState.State) {
 *     return { greeting: `${state.greeting} You get the special path.` };
 *   }
 *   function normalCase(state: typeof ToyState.State) {
 *     return { greeting: `${state.greeting} Nothing special here.` };
 *   }
 *
 *   // 3. A router is a plain function too, but it returns a STRING (the
 *   //    name of the next node) instead of a state update. It runs AFTER
 *   //    the node you attach it to, and reads whatever that node just wrote.
 *   function routeOnName(state: typeof ToyState.State): "special" | "normal" {
 *     return state.name === "Aiden" ? "special" : "normal";
 *   }
 *
 *   // 4. Build it. `new StateGraph(schema)` starts an empty graph;
 *   //    `.addNode(name, fn)` registers a node under a string id — that id
 *   //    is what edges reference, it doesn't have to match the fn's name
 *   //    (matching it is just convention, and a sane one).
 *   const toy = new StateGraph(ToyState)
 *     .addNode("greet", greet)
 *     .addNode("special", specialCase)
 *     .addNode("normal", normalCase)
 *     // START/END are sentinel values, not real nodes — every graph needs
 *     // exactly one edge in from START and at least one path reaching END.
 *     .addEdge(START, "greet")
 *     // A plain .addEdge is unconditional: A always runs, then B always runs.
 *     .addConditionalEdges("greet", routeOnName, {
 *       // The router returned "special" or "normal" above (the object KEYS).
 *       // Each key maps to the actual node id to jump to (the VALUES) — for
 *       // us they're spelled the same, but LangGraph is matching the router's
 *       // return value against these keys, not guessing a node name from it.
 *       special: "special",
 *       normal: "normal",
 *     })
 *     .addEdge("special", END)
 *     .addEdge("normal", END)
 *     .compile(); // <- returns the invokable graph; nothing runs before this
 *
 *   // 5. Run it. You pass a PARTIAL initial state (fields with no default
 *   //    are required); you get back the FULL final state after every node
 *   //    on the path it took has run and merged its update in.
 *   const result = await toy.invoke({ name: "Aiden" });
 *   console.log(result.greeting); // "Hello, Aiden! You get the special path."
 *
 * ── THE REAL GRAPH ──────────────────────────────────────────────────────
 *
 * Same five moves, applied to graph/state.ts and graph/nodes/*.ts:
 *
 *   retrieveContext → fetchWeather → fetchHazardBulletin → checkCommunityReports → assessRisk
 *                                                                                       │
 *                                        ┌──────────────────────────────────────────────┤ (conditional)
 *                                        ▼                                               ▼
 *                                 checkExperience                                   synthesize
 *                                        │                                               ▲
 *                                        └───────────────────────────────────────────────┘
 *
 *   1. `new StateGraph(SummitMindState)` — the real schema, already built.
 *   2. `.addNode("retrieveContext", retrieveContext)` — one call per
 *      imported node function below (including `checkCommunityReports`, the
 *      newest one), using the exact string names `routeAfterRiskAssessment`
 *      (in assessRisk.ts) returns.
 *   3. `.addEdge(START, "retrieveContext")`, then chain the straight-line
 *      edges through fetchWeather → fetchHazardBulletin →
 *      checkCommunityReports → assessRisk — each is just another
 *      unconditional `.addEdge("a", "b")`.
 *   4. `.addConditionalEdges("assessRisk", routeAfterRiskAssessment, {
 *        checkExperience: "checkExperience", synthesize: "synthesize",
 *      })` — this is the toy graph's step 4, applied here: the object maps
 *      the router's two possible return strings to the real node ids.
 *   5. `.addEdge("checkExperience", "synthesize")`, `.addEdge("synthesize", END)`.
 *   6. `.compile()` and return it.
 *
 * RESOURCES:
 *   - StateGraph: https://langchain-ai.github.io/langgraphjs/concepts/low_level/#graphs
 *   - Worked example close to this shape: https://langchain-ai.github.io/langgraphjs/tutorials/introduction/
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { SummitMindState, type SummitMindStateType } from "./state";
import { retrieveContext } from "./nodes/retrieveContext";
import { fetchWeather } from "./nodes/fetchWeather";
import { fetchHazardBulletin } from "./nodes/fetchHazardBulletin";
import { checkCommunityReports } from "./nodes/checkCommunityReports";
import { checkExperience } from "./nodes/checkExperience";
import { assessRisk, routeAfterRiskAssessment } from "./nodes/assessRisk";
import { synthesize } from "./nodes/synthesize";

// The contract the API route (and anything else) needs from this module:
// something invokable with a partial state that resolves to the full state.
// `.compile()`'s real return type satisfies this structurally, so once you
// implement the function below you can delete this annotation entirely and
// let TS infer the real (more specific) type instead.
export type CompiledSummitMindGraph = {
  invoke: (input: Partial<SummitMindStateType>) => Promise<SummitMindStateType>;
};

export function buildSummitMindGraph(): CompiledSummitMindGraph {
  throw new Error("TODO: wire the StateGraph — see comment above");
}

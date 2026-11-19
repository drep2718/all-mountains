import { describe, it } from "vitest";

// Integration-shaped, once the nodes above have their own unit coverage —
// this is about the WIRING, not re-testing each node's logic.
describe("buildSummitMindGraph", () => {
  it.todo("a high-hazard input reaches synthesize without passing through checkExperience");
  it.todo("a low-hazard input passes through checkExperience before synthesize");
  it.todo("every node in graph/nodes/* is reachable from START");
});

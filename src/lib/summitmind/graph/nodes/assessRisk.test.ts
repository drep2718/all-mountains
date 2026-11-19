import { describe, it } from "vitest";

// The branch that makes the safety design real — worth the most test
// attention of any node in the graph.
describe("assessRisk", () => {
  it.todo("sets ledWithWarning: true when hazard.level is 'considerable' or worse");
  it.todo("sets ledWithWarning: true when hazard.level is 'unknown' (no bulletin coverage)");
  it.todo("sets ledWithWarning: false for a low-hazard, ordinary-weather state");
});

describe("routeAfterRiskAssessment", () => {
  it.todo("routes to 'synthesize' directly when ledWithWarning is true");
  it.todo("routes to 'checkExperience' when ledWithWarning is false");
});

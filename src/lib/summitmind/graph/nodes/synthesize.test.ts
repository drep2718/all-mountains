import { describe, it } from "vitest";

// The grounding rule, tested: this is what actually enforces the roadmap's
// "the LLM synthesizes, it never invents numbers" design principle.
describe("synthesize", () => {
  it.todo("every numeric hazard/weather claim in the prompt sent to the LLM traces back to a state field");
  it.todo("leads the response with the warning when state.ledWithWarning is true");
  it.todo("states plainly that no bulletin covers the area when hazard.level is 'unknown'");
  it.todo("returned sources array matches (is a subset of, not a superset of) state.sources");
});

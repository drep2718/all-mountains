import { describe, it } from "vitest";

// This is the honesty-critical tool — these cases exist specifically to
// pin down the "no coverage" behavior so a future change can't quietly
// regress it into fabricating a hazard level.
describe("getHazardBulletin", () => {
  it.todo("returns level: 'unknown' with empty sources for coordinates outside every configured region");
  it.todo("returns a mapped HazardLevel + populated Source for coordinates inside a configured region");
  it.todo("never throws for missing coverage — only for an actual fetch/parse failure on a covered region");
});

import { describe, expect, it } from "vitest";
import { sortListItems, type ListItem, type ListSort } from "@/lib/lists";
import type { Peak, PeakDifficulty } from "@/lib/peak-types";

/** Only the fields the sort reads; the rest of Peak is irrelevant here. */
function item(
  slug: string,
  elevation_m: number | null,
  difficulty: PeakDifficulty | null,
  name = slug
): ListItem {
  return {
    id: Math.random(),
    list_id: 1,
    peak_slug: slug,
    created_at: "2026-01-01",
    peak:
      elevation_m == null && difficulty == null && name === slug
        ? null
        : ({ name, elevation_m, difficulty } as unknown as Peak),
  };
}

const names = (items: ListItem[]) => items.map((i) => i.peak?.name ?? i.peak_slug);

const everest = item("everest", 8849, "technical", "Everest");
const whitney = item("whitney", 4421, "hike", "Whitney");
const shasta = item("shasta", 4322, "technical", "Shasta");
const flattop = item("flattop", 1070, "hike", "Flattop");
const scrambly = item("ben", 1345, "scramble", "Ben Nevis");

describe("sortListItems", () => {
  const list = [whitney, flattop, everest, scrambly, shasta];

  it("leaves the list alone by default", () => {
    // The order a person added things in is the one arrangement they chose.
    const out = sortListItems(list, "added");
    expect(out).toBe(list);
  });

  it("sorts by height, both ways", () => {
    expect(names(sortListItems(list, "highest"))).toEqual([
      "Everest",
      "Whitney",
      "Shasta",
      "Ben Nevis",
      "Flattop",
    ]);
    expect(names(sortListItems(list, "lowest"))).toEqual([
      "Flattop",
      "Ben Nevis",
      "Shasta",
      "Whitney",
      "Everest",
    ]);
  });

  it("sorts by grade in the order grades actually get harder", () => {
    // Not alphabetical: hike < scramble < technical.
    const hardest = sortListItems(list, "hardest").map((i) => i.peak?.difficulty);
    expect(hardest).toEqual(["technical", "technical", "scramble", "hike", "hike"]);
    const easiest = sortListItems(list, "easiest").map((i) => i.peak?.difficulty);
    expect(easiest).toEqual(["hike", "hike", "scramble", "technical", "technical"]);
  });

  it("breaks a grade tie by height, in the direction of the sort", () => {
    // Two technical peaks under "hardest": the bigger one leads.
    expect(names(sortListItems(list, "hardest")).slice(0, 2)).toEqual(["Everest", "Shasta"]);
    // Two walk-ups under "easiest": the smaller one leads. Tie-breaking
    // the same way for both directions made "Easiest first" open on the
    // highest peak in the list.
    expect(names(sortListItems(list, "easiest")).slice(0, 2)).toEqual(["Flattop", "Whitney"]);
  });

  it("never mutates the array it was given", () => {
    const before = [...list];
    sortListItems(list, "highest");
    expect(list).toEqual(before);
  });

  it("puts rows with no data last, whichever direction", () => {
    // A row whose peak failed to join must not lead "Highest first" by
    // being treated as zero — that reads as a broken sort, not missing data.
    const orphan = item("ghost-peak", null, null);
    const withGap = [orphan, whitney, everest];
    expect(names(sortListItems(withGap, "highest")).at(-1)).toBe("ghost-peak");
    expect(names(sortListItems(withGap, "lowest")).at(-1)).toBe("ghost-peak");
    expect(names(sortListItems(withGap, "hardest")).at(-1)).toBe("ghost-peak");
    expect(names(sortListItems(withGap, "easiest")).at(-1)).toBe("ghost-peak");
  });

  it("sorts by name, falling back to the slug when there is no peak", () => {
    const orphan = item("aaa-missing", null, null);
    expect(names(sortListItems([everest, orphan, flattop], "name"))).toEqual([
      "aaa-missing",
      "Everest",
      "Flattop",
    ]);
  });

  it("handles an empty list and a single item", () => {
    for (const sort of ["highest", "hardest", "name"] as ListSort[]) {
      expect(sortListItems([], sort)).toEqual([]);
      expect(names(sortListItems([everest], sort))).toEqual(["Everest"]);
    }
  });
});

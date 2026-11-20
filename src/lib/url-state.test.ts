import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, decodeFilters, encodeFilters, LENGTH_CAP } from "@/lib/filters";
import { decodePlace, encodePlace } from "@/lib/geocode";

/**
 * These codecs exist so the back button restores a filtered list. The round
 * trip has to be exact — a filter that comes back subtly different is worse
 * than one that is lost, because the page then looks correct and is not.
 */

describe("filters in the URL", () => {
  it("keeps the default filters out of the URL entirely", () => {
    expect(encodeFilters(DEFAULT_FILTERS)).toBe("");
  });

  it("round-trips a full set of filters", () => {
    const f = {
      difficulty: ["hike", "scramble"] as const,
      routeType: ["Out & Back", "Loop"],
      activities: ["Trail running"],
      features: ["Waterfall", "Lake"],
      lengthMin: 3,
      lengthMax: 18,
      iconicOnly: true,
    };
    expect(decodeFilters(encodeFilters({ ...f, difficulty: [...f.difficulty] }))).toEqual({
      ...f,
      difficulty: [...f.difficulty],
    });
  });

  it("survives the spaces in multi-word values", () => {
    const f = { ...DEFAULT_FILTERS, routeType: ["Point to Point"] };
    expect(decodeFilters(encodeFilters(f)).routeType).toEqual(["Point to Point"]);
  });

  it("treats the length cap as no upper limit, not as a value to store", () => {
    const f = { ...DEFAULT_FILTERS, lengthMax: LENGTH_CAP };
    expect(encodeFilters(f)).toBe("");
    expect(decodeFilters("").lengthMax).toBe(LENGTH_CAP);
  });

  it("drops values a hand-edited URL invented", () => {
    const got = decodeFilters("d.hike.sorcery-t.Loop.Teleport");
    expect(got.difficulty).toEqual(["hike"]);
    expect(got.routeType).toEqual(["Loop"]);
  });

  it("refuses a reversed length range rather than matching nothing", () => {
    const got = decodeFilters("lo.30-hi.5");
    expect(got.lengthMin).toBe(0);
    expect(got.lengthMax).toBe(5);
  });

  it("returns the defaults for junk", () => {
    expect(decodeFilters("%%%")).toEqual(DEFAULT_FILTERS);
    expect(decodeFilters("")).toEqual(DEFAULT_FILTERS);
  });
});

describe("a searched place in the URL", () => {
  it("round-trips name, centre and bbox", () => {
    const p = {
      name: "Chamonix, France",
      center: [6.8694, 45.9237] as [number, number],
      bbox: [6.8, 45.88, 6.93, 45.96] as [number, number, number, number],
    };
    const back = decodePlace(encodePlace(p));
    expect(back?.name).toBe(p.name);
    expect(back?.center[0]).toBeCloseTo(p.center[0], 4);
    expect(back?.bbox?.[3]).toBeCloseTo(p.bbox[3], 4);
  });

  it("handles a place with no bounding box", () => {
    const p = { name: "Mount Shasta", center: [-122.19, 41.41] as [number, number], bbox: null };
    const back = decodePlace(encodePlace(p));
    expect(back?.name).toBe("Mount Shasta");
    expect(back?.bbox).toBeNull();
  });

  it("keeps commas in a place name, which is why the separator is not one", () => {
    const p = {
      name: "Zermatt, Valais, Switzerland",
      center: [7.75, 46.02] as [number, number],
      bbox: null,
    };
    expect(decodePlace(encodePlace(p))?.name).toBe("Zermatt, Valais, Switzerland");
  });

  it("returns null rather than a half-built place", () => {
    expect(decodePlace("")).toBeNull();
    expect(decodePlace("JustAName")).toBeNull();
    expect(decodePlace("Name~notanumber")).toBeNull();
  });
});

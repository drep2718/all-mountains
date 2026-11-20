import { describe, expect, it } from "vitest";
import { coverageNotice, describeSummitGap, routeCoverage } from "@/lib/summit-gap";

describe("describeSummitGap", () => {
  it("says nothing about a route that reaches the top", () => {
    expect(
      describeSummitGap({
        isSummitRoute: true,
        distanceToSummitM: 40,
        highPointM: 1150,
        summitElevationM: 1164,
      })
    ).toBeNull();
  });

  it("prefers height over plan view — the Perseverance Trail case", () => {
    // 104 m away, 830 m below. The horizontal number alone reads as
    // "practically there" and is the reason this function exists.
    const gap = describeSummitGap({
      isSummitRoute: false,
      distanceToSummitM: 104,
      highPointM: 334,
      summitElevationM: 1164,
    });
    expect(gap?.vertical).toBe(true);
    expect(gap?.label).toBe("stops 830 m below the top");
    // The plan-view figure is still available, just not the headline.
    expect(gap?.detail).toContain("104 m away in plan view");
  });

  it("falls back to plan view when the height was never measured", () => {
    const gap = describeSummitGap({
      isSummitRoute: false,
      distanceToSummitM: 287,
      highPointM: null,
      summitElevationM: 1164,
    });
    expect(gap?.vertical).toBe(false);
    expect(gap?.label).toBe("passes 287 m from the top");
    expect(gap?.detail).toContain("has not been measured");
  });

  it("says the gap is sideways when the route did reach summit height", () => {
    const gap = describeSummitGap({
      isSummitRoute: false,
      distanceToSummitM: 610,
      highPointM: 1150,
      summitElevationM: 1164,
    });
    expect(gap?.vertical).toBe(false);
    expect(gap?.label).toBe("passes 610 m from the top");
    expect(gap?.detail).toContain("Reaches summit height");
  });

  it("does not quibble over a few metres of DEM noise", () => {
    const gap = describeSummitGap({
      isSummitRoute: false,
      distanceToSummitM: null,
      highPointM: 1160,
      summitElevationM: 1164,
    });
    // 4 m below and no horizontal figure: nothing worth saying.
    expect(gap).toBeNull();
  });

  it("never reports a negative distance", () => {
    const gap = describeSummitGap({
      isSummitRoute: false,
      distanceToSummitM: -3,
      highPointM: null,
      summitElevationM: null,
    });
    expect(gap?.label).toBe("passes 0 m from the top");
  });

  it("handles the Vinson case without understating it", () => {
    const gap = describeSummitGap({
      isSummitRoute: false,
      distanceToSummitM: 72,
      highPointM: 2827,
      summitElevationM: 4892,
    });
    expect(gap?.label).toBe("stops 2,065 m below the top");
  });
});

describe("routeCoverage", () => {
  it("distinguishes no routes from routes that stop short", () => {
    expect(routeCoverage([])).toBe("none");
    expect(routeCoverage([{ is_summit_route: false }])).toBe("partial");
    expect(routeCoverage([{ is_summit_route: false }, { is_summit_route: true }])).toBe("summit");
  });
});

describe("coverageNotice", () => {
  it("stays quiet when a summit route exists", () => {
    expect(coverageNotice("summit", 4)).toBeNull();
  });

  it("explains an empty list rather than leaving a blank", () => {
    const n = coverageNotice("none", 0);
    expect(n?.title).toBe("No mapped routes");
    expect(n?.body).toContain("OpenStreetMap");
  });

  it("agrees with itself about singular and plural", () => {
    expect(coverageNotice("partial", 1)?.body).toContain("The route below approaches");
    expect(coverageNotice("partial", 3)?.body).toContain("The 3 routes below approach");
  });
});

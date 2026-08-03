import { area, booleanPointInPolygon, polygon as turfPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { coastalRibbon, landMask } from "./coastline.js";
import type { RatioGrid } from "./contour.js";

/**
 * 4x4 grid over a bbox chosen so grid x maps straight onto longitude and
 * latitude counts back down from the top row — same convention as contour.test.ts.
 */
function grid(sceneCount: number[]): RatioGrid {
  return {
    width: 4,
    height: 4,
    ratio: sceneCount.map(() => 1),
    sceneCount,
    bbox: [0, 0, 4, 4],
  };
}

/** Right half land (no contributing scenes), left half water. */
const RIGHT_LAND = [10, 10, 0, 0, 10, 10, 0, 0, 10, 10, 0, 0, 10, 10, 0, 0];

describe("landMask", () => {
  it("traces the land, not the water", () => {
    const land = landMask(grid(RIGHT_LAND));
    expect(land.type).toBe("MultiPolygon");
    expect(booleanPointInPolygon([3.5, 2], land)).toBe(true);
    expect(booleanPointInPolygon([0.5, 2], land)).toBe(false);
  });

  it("honours a minimum scene count", () => {
    const thin = grid(RIGHT_LAND.map((v) => (v > 0 ? 2 : 0)));
    const strict = landMask(thin, { minSceneCount: 5 });
    // With a stricter gate, even the "water" half no longer qualifies as water.
    expect(booleanPointInPolygon([0.5, 2], strict)).toBe(true);
  });

  it("returns an empty MultiPolygon when everything is water", () => {
    const land = landMask(grid(RIGHT_LAND.map(() => 10)));
    expect(land.coordinates).toEqual([]);
  });
});

describe("coastalRibbon", () => {
  it("covers the coast out to the given distance", () => {
    const land = landMask(grid(RIGHT_LAND));
    const ribbon = coastalRibbon(land, 50_000); // huge distance in this degree-sized grid, just to get clear separation
    expect(ribbon).not.toBeNull();
    // A point on the water side, near the land/water boundary, should be swallowed by the ribbon.
    expect(booleanPointInPolygon([1.9, 2], ribbon as GeoJSON.Polygon)).toBe(true);
  });

  it("grows as the distance grows", () => {
    const land = landMask(grid(RIGHT_LAND));
    const near = coastalRibbon(land, 10_000);
    const far = coastalRibbon(land, 50_000);
    expect(area(turfPolygon((far as GeoJSON.Polygon).coordinates))).toBeGreaterThan(
      area(turfPolygon((near as GeoJSON.Polygon).coordinates)),
    );
  });

  it("returns null at zero metres", () => {
    const land = landMask(grid(RIGHT_LAND));
    expect(coastalRibbon(land, 0)).toBeNull();
  });

  it("returns null when there is no land", () => {
    const land = landMask(grid(RIGHT_LAND.map(() => 10)));
    expect(coastalRibbon(land, 30)).toBeNull();
  });

  it("does not swallow land far from the coast (issue #30)", () => {
    // The land half is 2 degrees (~220 km) wide — far wider than the 5 km
    // ribbon below, so a point deep inland must stay out of the ribbon.
    // Before the fix, an unbounded outward buffer of the whole land mass
    // included it regardless of distance from shore.
    const land = landMask(grid(RIGHT_LAND));
    const ribbon = coastalRibbon(land, 5_000) as GeoJSON.Polygon;
    // x=3 sits in the middle of the 2-degree-wide land mass — ~110 km from
    // both the shoreline at x=2 and the grid's far edge at x=4, well beyond
    // the 5 km ribbon on either side.
    expect(booleanPointInPolygon([3, 2], ribbon)).toBe(false);
  });

  it("still covers land right at the coast", () => {
    const land = landMask(grid(RIGHT_LAND));
    const ribbon = coastalRibbon(land, 5_000) as GeoJSON.Polygon;
    expect(booleanPointInPolygon([2.01, 2], ribbon)).toBe(true);
  });
});

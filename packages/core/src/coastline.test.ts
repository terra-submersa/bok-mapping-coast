import { area, booleanPointInPolygon } from "@turf/turf";
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
    expect(booleanPointInPolygon([1.9, 2], ribbon as GeoJSON.MultiPolygon)).toBe(true);
  });

  it("grows as the distance grows", () => {
    const land = landMask(grid(RIGHT_LAND));
    const near = coastalRibbon(land, 10_000);
    const far = coastalRibbon(land, 50_000);
    expect(area(far as GeoJSON.MultiPolygon)).toBeGreaterThan(area(near as GeoJSON.MultiPolygon));
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
    const ribbon = coastalRibbon(land, 5_000) as GeoJSON.MultiPolygon;
    // x=3 sits in the middle of the 2-degree-wide land mass — ~110 km from
    // both the shoreline at x=2 and the grid's far edge at x=4, well beyond
    // the 5 km ribbon on either side.
    expect(booleanPointInPolygon([3, 2], ribbon)).toBe(false);
  });

  it("never covers land, even right at the coast (issue #31)", () => {
    const land = landMask(grid(RIGHT_LAND));
    const ribbon = coastalRibbon(land, 5_000) as GeoJSON.MultiPolygon;
    // Just inland of the coastline at x=2 — before the fix, the ribbon
    // straddled the coast and covered this point too.
    expect(booleanPointInPolygon([2.01, 2], ribbon)).toBe(false);
    // Just on the water side of the same boundary — still fully covered.
    expect(booleanPointInPolygon([1.99, 2], ribbon)).toBe(true);
  });

  it("gives every landmass its own ribbon, not just the largest (issue #31)", () => {
    // A small islet (1 degree wide) on the left and a much bigger mainland
    // (3 degrees wide) on the right, separated by 4 degrees of open water —
    // far more than the 5 km ribbon distance, so the two never touch.
    const wideGrid: RatioGrid = {
      width: 8,
      height: 4,
      ratio: new Array(32).fill(1),
      sceneCount: new Array(4).fill([0, 10, 10, 10, 10, 0, 0, 0]).flat(),
      bbox: [0, 0, 8, 4],
    };
    const land = landMask(wideGrid);
    const ribbon = coastalRibbon(land, 5_000) as GeoJSON.MultiPolygon;
    // Water just off the islet (coastline at x=1) ...
    expect(booleanPointInPolygon([1.01, 2], ribbon)).toBe(true);
    // ... and water just off the mainland (coastline at x=5) — both covered.
    // Before the fix, `largestPolygon` kept only the mainland's larger band
    // and silently dropped the islet's.
    expect(booleanPointInPolygon([4.99, 2], ribbon)).toBe(true);
  });
});

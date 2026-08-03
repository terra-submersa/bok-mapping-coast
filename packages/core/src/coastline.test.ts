import { area, booleanPointInPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { type Aoi, rectangleAoi } from "./aoi.js";
import type { BBox } from "./bbox.js";
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

const AOI: Aoi = rectangleAoi([0, 0, 4, 4]);

/**
 * Kiladha in miniature: a staircase coastline filling the lower-left corner —
 * so the landmass is cut by *two* AOI edges, west and south — plus an island
 * sitting wholly in open water. This is the shape that exposed issue #32: the
 * cuts are not real coastline, and buffering across them wrapped the band all
 * the way around the mainland.
 *
 * 8x8 over an 8-degree box, so grid x maps straight onto longitude and
 * latitude counts back down from the top row.
 */
const KILADHA_BBOX: BBox = [0, 0, 8, 8];
const KILADHA_AOI: Aoi = rectangleAoi(KILADHA_BBOX);

function kiladhaGrid(): RatioGrid {
  const sceneCount: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const mainland = x + (7 - y) < 4;
      const island = x >= 5 && x <= 6 && y >= 2 && y <= 3;
      sceneCount.push(mainland || island ? 0 : 10);
    }
  }
  return { width: 8, height: 8, ratio: sceneCount.map(() => 1), sceneCount, bbox: KILADHA_BBOX };
}

/** Every position across every ring of every piece. */
function positions(geometry: GeoJSON.MultiPolygon): GeoJSON.Position[] {
  return geometry.coordinates.flat(2);
}

/**
 * A grid at Kiladha's real scale: 100x100 over ~0.01°, so a cell is ~8.8 x
 * 11.1 m — Sentinel-2's 10 m bands. Needed for the area-threshold tests,
 * where the degree-sized fixtures above are meaninglessly large.
 */
const REALISTIC_BBOX: BBox = [23.1, 37.4, 23.11, 37.41];
const REALISTIC_AOI: Aoi = rectangleAoi(REALISTIC_BBOX);

function realisticGrid(isLand: (x: number, y: number) => boolean): RatioGrid {
  const sceneCount: number[] = [];
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 100; x++) sceneCount.push(isLand(x, y) ? 0 : 10);
  }
  return {
    width: 100,
    height: 100,
    ratio: sceneCount.map(() => 1),
    sceneCount,
    bbox: REALISTIC_BBOX,
  };
}

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

  it("drops a single-pixel speck as no-data, not land (issue #34)", () => {
    // One ~98 m² pixel: a permanently cloudy pixel or a boat, not an island.
    const land = landMask(realisticGrid((x, y) => x === 50 && y === 50));
    expect(land.coordinates).toEqual([]);
  });

  it("keeps an islet comfortably above the threshold (issue #34)", () => {
    // 5x5 pixels ≈ 2,460 m², well past MIN_LANDMASS_AREA_M2.
    const land = landMask(realisticGrid((x, y) => x >= 50 && x < 55 && y >= 50 && y < 55));
    expect(land.coordinates).toHaveLength(1);
    expect(booleanPointInPolygon([23.1052, 37.4048], land)).toBe(true);
  });

  it("keeps the real coastline while dropping specks around it (issue #34)", () => {
    const land = landMask(
      realisticGrid((x, y) => x > 70 || (x === 10 && y === 10) || (x === 20 && y === 80)),
    );
    // The mainland survives; both specks are gone.
    expect(land.coordinates).toHaveLength(1);
  });

  it("honours an explicit minimum landmass area", () => {
    const speck = (x: number, y: number) => x === 50 && y === 50;
    expect(landMask(realisticGrid(speck), { minLandmassAreaM2: 0 }).coordinates).toHaveLength(1);
  });
});

describe("coastalRibbon", () => {
  it("covers the coast out to the given distance", () => {
    const land = landMask(grid(RIGHT_LAND));
    const ribbon = coastalRibbon(land, 50_000, AOI); // huge distance in this degree-sized grid, just to get clear separation
    expect(ribbon).not.toBeNull();
    // A point on the water side, near the land/water boundary, should be swallowed by the ribbon.
    expect(booleanPointInPolygon([1.9, 2], ribbon as GeoJSON.MultiPolygon)).toBe(true);
  });

  it("grows as the distance grows", () => {
    const land = landMask(grid(RIGHT_LAND));
    const near = coastalRibbon(land, 10_000, AOI);
    const far = coastalRibbon(land, 50_000, AOI);
    expect(area(far as GeoJSON.MultiPolygon)).toBeGreaterThan(area(near as GeoJSON.MultiPolygon));
  });

  it("returns null at zero metres", () => {
    const land = landMask(grid(RIGHT_LAND));
    expect(coastalRibbon(land, 0, AOI)).toBeNull();
  });

  it("returns null when there is no land", () => {
    const land = landMask(grid(RIGHT_LAND.map(() => 10)));
    expect(coastalRibbon(land, 30, AOI)).toBeNull();
  });

  it("does not swallow land far from the coast (issue #30)", () => {
    // The land half is 2 degrees (~220 km) wide — far wider than the 5 km
    // ribbon below, so a point deep inland must stay out of the ribbon.
    // Before the fix, an unbounded outward buffer of the whole land mass
    // included it regardless of distance from shore.
    const land = landMask(grid(RIGHT_LAND));
    const ribbon = coastalRibbon(land, 5_000, AOI) as GeoJSON.MultiPolygon;
    // x=3 sits in the middle of the 2-degree-wide land mass — ~110 km from
    // both the shoreline at x=2 and the grid's far edge at x=4, well beyond
    // the 5 km ribbon on either side.
    expect(booleanPointInPolygon([3, 2], ribbon)).toBe(false);
  });

  it("never covers land, even right at the coast (issue #31)", () => {
    const land = landMask(grid(RIGHT_LAND));
    const ribbon = coastalRibbon(land, 5_000, AOI) as GeoJSON.MultiPolygon;
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
    const ribbon = coastalRibbon(land, 5_000, rectangleAoi([0, 0, 8, 4])) as GeoJSON.MultiPolygon;
    // Water just off the islet (coastline at x=1) ...
    expect(booleanPointInPolygon([1.01, 2], ribbon)).toBe(true);
    // ... and water just off the mainland (coastline at x=5) — both covered.
    // Before the fix, `largestPolygon` kept only the mainland's larger band
    // and silently dropped the islet's.
    expect(booleanPointInPolygon([4.99, 2], ribbon)).toBe(true);
  });

  it("never extends outside the AOI (issue #32)", () => {
    const ribbon = coastalRibbon(landMask(kiladhaGrid()), 50_000, KILADHA_AOI);
    const [minLon, minLat, maxLon, maxLat] = KILADHA_BBOX;
    for (const [lon, lat] of positions(ribbon as GeoJSON.MultiPolygon)) {
      expect(lon).toBeGreaterThanOrEqual(minLon);
      expect(lon).toBeLessThanOrEqual(maxLon);
      expect(lat).toBeGreaterThanOrEqual(minLat);
      expect(lat).toBeLessThanOrEqual(maxLat);
    }
  });

  it("stops at the AOI edge instead of wrapping a landmass that is cut by it (issue #32)", () => {
    const ribbon = coastalRibbon(
      landMask(kiladhaGrid()),
      50_000,
      KILADHA_AOI,
    ) as GeoJSON.MultiPolygon;

    // The mainland fills the lower-left corner, so its boundary is part real
    // coastline and part AOI cut. The band along it must be an open strip: no
    // ring may enclose the land. Testing the *outer ring only* is the point —
    // that is all `boundaryKml` serialises, so a wrap that survived as a hole
    // still exported a mission over the village.
    const outerRingsOnly: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: ribbon.coordinates.map((piece) => [piece[0]]),
    };
    // d3-contour interpolates the staircase into a clean diagonal, so the
    // mainland is the triangle between lon+lat ≈ 0.5 and lon+lat ≈ 3.5. Both
    // points below sit inside it, ~100 km from the coast either way — far
    // beyond the 50 km band.
    expect(booleanPointInPolygon([1, 1], outerRingsOnly)).toBe(false);
    expect(booleanPointInPolygon([0.5, 1.5], outerRingsOnly)).toBe(false);

    // The seaward side of that same coastline is still fully covered.
    expect(booleanPointInPolygon([4.1, 0.5], ribbon)).toBe(true);
  });

  it("gives no ribbon to a speck that was never land (issue #34)", () => {
    // A lone no-data pixel in open water. Before the landmass filter this grew
    // its own donut of survey area in the middle of nowhere — invisible while
    // the pipeline collapsed to the largest piece, litter once it stopped.
    const speck = landMask(realisticGrid((x, y) => x === 50 && y === 50));
    expect(coastalRibbon(speck, 100, REALISTIC_AOI)).toBeNull();
  });

  it("still rings an islet that clears the threshold (issue #34)", () => {
    const islet = landMask(realisticGrid((x, y) => x >= 50 && x < 55 && y >= 50 && y < 55));
    const ribbon = coastalRibbon(islet, 100, REALISTIC_AOI);
    expect(ribbon).not.toBeNull();
    // Water just off the islet's west side is covered.
    expect(booleanPointInPolygon([23.1049, 37.4048], ribbon as GeoJSON.MultiPolygon)).toBe(true);
  });

  it("still rings an island that lies wholly inside the AOI (issue #32)", () => {
    const ribbon = coastalRibbon(
      landMask(kiladhaGrid()),
      50_000,
      KILADHA_AOI,
    ) as GeoJSON.MultiPolygon;

    // No cut to buffer across here, so the annulus is real and correct.
    expect(booleanPointInPolygon([4.9, 5], ribbon)).toBe(true); // west of the island
    expect(booleanPointInPolygon([7.1, 5], ribbon)).toBe(true); // east of it
    expect(booleanPointInPolygon([6, 5], ribbon)).toBe(false); // the island itself

    // Open water far from any coast stays out.
    expect(booleanPointInPolygon([2, 7], ribbon)).toBe(false);
  });
});

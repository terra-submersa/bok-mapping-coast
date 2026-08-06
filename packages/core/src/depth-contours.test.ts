import { describe, expect, it } from "vitest";
import type { RatioGrid } from "./contour.js";
import {
  type DepthContourLevel,
  depthContourLines,
  MAX_DEPTH_CONTOUR_LEVELS,
  planDepthContours,
} from "./depth-contours.js";
import { type DepthFit, ratioToDepth } from "./depth-fit.js";

/** `depth = 10 · ratio − 10`, so ratio 1.0 is the waterline and 1.1 is one metre. */
const FIT: DepthFit = { m1: 10, m0: 10, r2: 1, rmseM: 0.1, n: 5 };

/** The ratio range that spans the given depths under FIT. */
function rangeForDepths(minM: number, maxM: number) {
  return { min: 1 + minM / 10, max: 1 + maxM / 10 };
}

function depths(levels: DepthContourLevel[]): number[] {
  return levels.map((level) => level.depthM);
}

describe("planDepthContours", () => {
  it("puts a level on every whole multiple inside the range", () => {
    const plan = planDepthContours(FIT, rangeForDepths(0.4, 4.6), 1);
    expect(depths(plan.levels)).toEqual([1, 2, 3, 4]);
    expect(plan.capped).toBe(false);
    expect(plan.availableCount).toBe(4);
    expect(plan.extentM?.min).toBeCloseTo(0.4, 9);
    expect(plan.extentM?.max).toBeCloseTo(4.6, 9);
  });

  /** The float-dust case: 3 × 0.5 must be 1.5, not 1.5000000000000002 on a label. */
  it("keeps half-metre levels exact", () => {
    const plan = planDepthContours(FIT, rangeForDepths(0.4, 2.6), 0.5);
    expect(depths(plan.levels)).toEqual([0.5, 1, 1.5, 2, 2.5]);
  });

  it("includes an endpoint that is itself a multiple", () => {
    const plan = planDepthContours(FIT, rangeForDepths(1, 3), 1);
    expect(depths(plan.levels)).toEqual([1, 2, 3]);
  });

  it("drops levels at or above the waterline", () => {
    // A poor fit can put the shallow end of the range above sea level; "−1 m" is not a depth.
    const plan = planDepthContours(FIT, rangeForDepths(-2, 2), 1);
    expect(depths(plan.levels)).toEqual([1, 2]);
  });

  it("caps by keeping the shallowest levels, not by thinning", () => {
    const plan = planDepthContours(FIT, rangeForDepths(0, 100), 0.5);
    expect(plan.availableCount).toBe(200);
    expect(plan.capped).toBe(true);
    expect(plan.levels).toHaveLength(MAX_DEPTH_CONTOUR_LEVELS);
    expect(plan.levels[0].depthM).toBe(0.5);
    expect(plan.levels[plan.levels.length - 1].depthM).toBe(20);
  });

  it("refuses metres without a usable fit", () => {
    const range = rangeForDepths(0, 10);
    for (const fit of [null, { ...FIT, m1: 0 }, { ...FIT, m1: -3 }]) {
      const plan = planDepthContours(fit, range, 1);
      expect(plan.levels).toEqual([]);
      expect(plan.capped).toBe(false);
      expect(plan.extentM).toBeNull();
    }
  });

  it("returns no levels for a non-positive interval, but still reports the extent", () => {
    for (const interval of [0, -1, Number.NaN]) {
      const plan = planDepthContours(FIT, rangeForDepths(0, 10), interval);
      expect(plan.levels).toEqual([]);
      expect(plan.extentM?.max).toBeCloseTo(10, 9);
    }
  });

  it("returns an empty plan without a range", () => {
    expect(planDepthContours(FIT, null, 1).levels).toEqual([]);
  });

  it("pairs each depth with the ratio that produces it", () => {
    const plan = planDepthContours(FIT, rangeForDepths(0, 6), 1);
    for (const level of plan.levels) {
      expect(ratioToDepth(FIT, level.ratio)).toBeCloseTo(level.depthM, 9);
    }
  });

  it("orders levels shallowest first in both depth and ratio", () => {
    const plan = planDepthContours(FIT, rangeForDepths(0, 12), 0.5);
    for (let i = 1; i < plan.levels.length; i++) {
      expect(plan.levels[i].depthM).toBeGreaterThan(plan.levels[i - 1].depthM);
      expect(plan.levels[i].ratio).toBeGreaterThan(plan.levels[i - 1].ratio);
    }
  });
});

/**
 * Grids over a bbox chosen so grid x maps straight onto longitude and latitude counts
 * back down from the top row, as in `contour.test.ts`.
 */
function grid(width: number, height: number, fill: (x: number, y: number) => number): RatioGrid {
  const ratio: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) ratio.push(fill(x, y));
  }
  return {
    width,
    height,
    ratio,
    sceneCount: ratio.map(() => 10),
    bbox: [0, 0, width, height],
  };
}

/** Deepens west to east: ratio 1.0 at column 0, +0.1 per column. */
function eastwardRamp(width = 10, height = 10): RatioGrid {
  return grid(width, height, (x) => 1 + 0.1 * x);
}

function positions(line: { geometry: GeoJSON.MultiLineString }): GeoJSON.Position[] {
  return line.geometry.coordinates.flat();
}

describe("depthContourLines", () => {
  it("returns one line per level, in the order given, deepening eastward", () => {
    const lines = depthContourLines(eastwardRamp(), [
      { depthM: 1.5, ratio: 1.15 },
      { depthM: 3.5, ratio: 1.35 },
      { depthM: 5.5, ratio: 1.55 },
    ]);

    expect(lines.map((l) => l.depthM)).toEqual([1.5, 3.5, 5.5]);
    const meanLon = lines.map((l) => {
      const points = positions(l);
      return points.reduce((sum, [lon]) => sum + lon, 0) / points.length;
    });
    expect(meanLon[0]).toBeLessThan(meanLon[1]);
    expect(meanLon[1]).toBeLessThan(meanLon[2]);
  });

  it("places a level between the columns whose ratios straddle it", () => {
    // 1.25 sits halfway between column 2 (1.2) and column 3 (1.3).
    const lines = depthContourLines(eastwardRamp(), [{ depthM: 2.5, ratio: 1.25 }]);
    for (const [lon] of positions(lines[0])) expect(lon).toBeCloseTo(3, 6);
  });

  /**
   * The assertion this whole design exists for.
   *
   * d3 returns a filled band, and near shore the water is shallower than every level,
   * so every band's outline runs along the coast. Emitted as polygons that would put a
   * depth label on the beach, once per level.
   */
  it("emits nothing where the band's only edge is the coastline", () => {
    const width = 6;
    const height = 6;
    const shallow = grid(width, height, (x) => (x < 3 ? 1 : 0));
    const sceneCount = shallow.ratio as number[];
    const land = {
      ...shallow,
      sceneCount: sceneCount.map((_, i) => (i % width < 3 ? 10 : 0)),
    };

    // Deeper than any water present: the band is every water pixel, bounded only by land.
    const lines = depthContourLines(land, [{ depthM: 5, ratio: 1.5 }]);
    expect(lines[0].geometry.coordinates).toEqual([]);
  });

  it("emits nothing along the grid's own rectangle", () => {
    const lines = depthContourLines(eastwardRamp(), [{ depthM: 2.5, ratio: 1.25 }]);
    const points = positions(lines[0]);
    expect(points.length).toBeGreaterThan(0);
    // The band covers the western columns, so its ring runs along three grid edges.
    // Only the isoline should have survived.
    for (const [lon, lat] of points) {
      expect(lon).toBeGreaterThan(0.5);
      expect(lon).toBeLessThan(9.5);
      expect(lat).toBeGreaterThan(0);
      expect(lat).toBeLessThan(10);
    }
  });

  it("masks to the AOI without leaving a strand along its edge", () => {
    const aoi: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [2, 3],
          [8, 3],
          [8, 7],
          [2, 7],
          [2, 3],
        ],
      ],
    };
    const lines = depthContourLines(eastwardRamp(), [{ depthM: 2.5, ratio: 1.25 }], { aoi });
    const points = positions(lines[0]);
    expect(points.length).toBeGreaterThan(0);
    for (const [lon, lat] of points) {
      // Every point is on the isoline at lon 3, never on the AOI's own edges.
      expect(lon).toBeCloseTo(3, 6);
      expect(lat).toBeGreaterThanOrEqual(3);
      expect(lat).toBeLessThanOrEqual(7);
    }
  });

  it("emits nothing for a level whose isoline falls outside the AOI", () => {
    const aoi: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [1, 3],
          [4, 3],
          [4, 7],
          [1, 7],
          [1, 3],
        ],
      ],
    };
    const lines = depthContourLines(eastwardRamp(), [{ depthM: 8.5, ratio: 1.85 }], { aoi });
    expect(lines[0].geometry.coordinates).toEqual([]);
  });

  it("honours a minimum scene count, matching shallowWaterContour", () => {
    const ramp = eastwardRamp();
    const thin = { ...ramp, sceneCount: (ramp.ratio as number[]).map(() => 2) };
    const lines = depthContourLines(thin, [{ depthM: 2.5, ratio: 1.25 }], { minSceneCount: 5 });
    expect(lines[0].geometry.coordinates).toEqual([]);
  });

  /** Issue #44's rule, carried over: a NaN must not leak into a coordinate. */
  it("excludes a non-finite ratio instead of contouring it", () => {
    const ramp = eastwardRamp();
    const ratio = (ramp.ratio as number[]).slice();
    ratio[34] = Number.NaN;
    const lines = depthContourLines({ ...ramp, ratio }, [{ depthM: 2.5, ratio: 1.25 }]);
    for (const [lon, lat] of positions(lines[0])) {
      expect(Number.isFinite(lon)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
    }
  });

  it("drops fragments shorter than minLengthM", () => {
    // One shallow pixel in an otherwise deep sea: a closed isoline a few metres round.
    const speck = grid(10, 10, (x, y) => (x === 5 && y === 5 ? 1 : 2));
    const level = [{ depthM: 5, ratio: 1.5 }];
    expect(depthContourLines(speck, level)[0].geometry.coordinates.length).toBe(1);
    // The bbox is a degree across, so one pixel is many kilometres — hence the size here.
    expect(
      depthContourLines(speck, level, { minLengthM: 1_000_000 })[0].geometry.coordinates,
    ).toEqual([]);
  });

  it("returns nothing for no levels, and nothing over an all-land grid", () => {
    const ramp = eastwardRamp();
    expect(depthContourLines(ramp, [])).toEqual([]);
    const allLand = { ...ramp, sceneCount: (ramp.ratio as number[]).map(() => 0) };
    expect(
      depthContourLines(allLand, [{ depthM: 2.5, ratio: 1.25 }])[0].geometry.coordinates,
    ).toEqual([]);
  });

  it("leaves the input grid untouched", () => {
    const ramp = eastwardRamp();
    const ratio = [...(ramp.ratio as number[])];
    const sceneCount = [...(ramp.sceneCount as number[])];
    depthContourLines(ramp, [{ depthM: 2.5, ratio: 1.25 }], { simplifyMetres: 20 });
    expect(ramp.ratio).toEqual(ratio);
    expect(ramp.sceneCount).toEqual(sceneCount);
  });

  it("simplifies without moving the endpoints", () => {
    // A wobbly isoline, so Douglas-Peucker has something to remove.
    const wobbly = grid(40, 40, (x, y) => 1 + 0.05 * (x + (y % 2)));
    const level = [{ depthM: 5, ratio: 1.5 }];
    const raw = depthContourLines(wobbly, level)[0];
    const smooth = depthContourLines(wobbly, level, { simplifyMetres: 5000 })[0];

    const rawPoints = positions(raw);
    const smoothPoints = positions(smooth);
    expect(smoothPoints.length).toBeLessThan(rawPoints.length);
    expect(smoothPoints[0]).toEqual(rawPoints[0]);
    expect(smoothPoints[smoothPoints.length - 1]).toEqual(rawPoints[rawPoints.length - 1]);
  });
});

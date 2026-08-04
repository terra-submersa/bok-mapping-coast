import { describe, expect, it } from "vitest";
import type { BBox } from "./bbox.js";
import {
  type CompositeTilePlan,
  MAX_COMPOSITE_PIXELS,
  planCompositeTiles,
} from "./composite-tiles.js";
import { checkProcessingApiLimit, PROCESSING_API_MAX_SIDE_PX } from "./processing-limit.js";

/** Kiladha Bay, the same envelope as scripts/spike-sdb-kiladha.mjs. */
const KILADHA: BBox = [23.105, 37.418, 23.14, 37.435];

/** Roughly 30 km across — over the cap on one axis only. */
const WIDE: BBox = [23.0, 37.4, 23.35, 37.42];

/** Roughly 60 km each way — over the cap on both. */
const BIG: BBox = [23.0, 37.0, 23.68, 37.54];

describe("planCompositeTiles", () => {
  it("leaves an AOI that already fits as a single tile", () => {
    const plan = planCompositeTiles(KILADHA);
    expect(plan.cols).toBe(1);
    expect(plan.rows).toBe(1);
    expect(plan.tiles).toHaveLength(1);
  });

  /**
   * The property that keeps every existing `.cache/composites` entry reachable: a
   * one-tile plan must produce exactly the request the API would have derived on its
   * own, floats included, because the cache key is the JSON of those raw floats.
   */
  it("gives a single tile the parent's exact bbox and native size", () => {
    const plan = planCompositeTiles(KILADHA);
    const [tile] = plan.tiles;

    expect(tile.bbox).toEqual(KILADHA);
    const { widthPx, heightPx } = checkProcessingApiLimit(KILADHA);
    expect(tile.width).toBe(Math.round(widthPx));
    expect(tile.height).toBe(Math.round(heightPx));
    expect(tile.x).toBe(0);
    expect(tile.y).toBe(0);
  });

  it("splits only the axis that exceeds the cap", () => {
    const plan = planCompositeTiles(WIDE);
    expect(plan.width).toBeGreaterThan(PROCESSING_API_MAX_SIDE_PX);
    expect(plan.cols).toBe(2);
    expect(plan.rows).toBe(1);
  });

  it("splits both axes when both exceed the cap", () => {
    const plan = planCompositeTiles(BIG);
    expect(plan.cols).toBeGreaterThan(1);
    expect(plan.rows).toBeGreaterThan(1);
    expect(plan.tiles).toHaveLength(plan.cols * plan.rows);
  });

  it("keeps every tile inside the Processing API cap", () => {
    for (const bbox of [KILADHA, WIDE, BIG]) {
      for (const tile of planCompositeTiles(bbox).tiles) {
        expect(tile.width).toBeLessThanOrEqual(PROCESSING_API_MAX_SIDE_PX);
        expect(tile.height).toBeLessThanOrEqual(PROCESSING_API_MAX_SIDE_PX);
        expect(tile.width).toBeGreaterThan(0);
        expect(tile.height).toBeGreaterThan(0);
      }
    }
  });

  it("tiles the pixel grid exactly, with no gap or overlap", () => {
    const plan = planCompositeTiles(BIG);

    // Row 0's widths must sum to the total, and every row must repeat that split.
    const firstRow = plan.tiles.filter((t) => t.row === 0);
    expect(firstRow.reduce((sum, t) => sum + t.width, 0)).toBe(plan.width);

    const firstCol = plan.tiles.filter((t) => t.col === 0);
    expect(firstCol.reduce((sum, t) => sum + t.height, 0)).toBe(plan.height);

    // Offsets are contiguous: each tile starts where the previous one ended.
    for (const tile of plan.tiles) {
      const left = plan.tiles.find((t) => t.row === tile.row && t.col === tile.col - 1);
      if (left) expect(tile.x).toBe(left.x + left.width);
      const above = plan.tiles.find((t) => t.col === tile.col && t.row === tile.row - 1);
      if (above) expect(tile.y).toBe(above.y + above.height);
    }
  });

  it("makes neighbouring tile bboxes share an exact edge", () => {
    const plan = planCompositeTiles(BIG);
    for (const tile of plan.tiles) {
      const right = plan.tiles.find((t) => t.row === tile.row && t.col === tile.col + 1);
      // Exact equality, not closeness: a shared edge computed twice must be one number,
      // or the two tiles cover slightly different ground.
      if (right) expect(right.bbox[0]).toBe(tile.bbox[2]);
      const below = plan.tiles.find((t) => t.col === tile.col && t.row === tile.row + 1);
      if (below) expect(below.bbox[3]).toBe(tile.bbox[1]);
    }
  });

  it("covers the parent envelope exactly at its corners", () => {
    const plan = planCompositeTiles(BIG);
    const [minLon, minLat, maxLon, maxLat] = plan.bbox;

    const northWest = plan.tiles.find((t) => t.row === 0 && t.col === 0);
    const southEast = plan.tiles.find((t) => t.row === plan.rows - 1 && t.col === plan.cols - 1);

    expect(northWest?.bbox[0]).toBe(minLon);
    expect(northWest?.bbox[3]).toBe(maxLat);
    expect(southEast?.bbox[2]).toBe(maxLon);
    expect(southEast?.bbox[1]).toBe(minLat);
  });

  /** Row 0 is the north edge, matching gridToLonLat — get this backwards and the mosaic is flipped. */
  it("orders rows north first", () => {
    const plan = planCompositeTiles(BIG);
    const northRow = plan.tiles.filter((t) => t.row === 0);
    const southRow = plan.tiles.filter((t) => t.row === plan.rows - 1);
    expect(northRow[0].bbox[3]).toBeGreaterThan(southRow[0].bbox[3]);
  });

  it("honours a smaller cap, which is how the tests above stay cheap", () => {
    const plan = planCompositeTiles(KILADHA, 100);
    expect(plan.cols).toBe(Math.ceil(plan.width / 100));
    expect(plan.rows).toBe(Math.ceil(plan.height / 100));
    expect(plan.tiles.every((t) => t.width <= 100 && t.height <= 100)).toBe(true);
  });

  it("refuses an AOI over the memory ceiling", () => {
    // ~1000 km across: far past anything the browser could hold.
    expect(() => planCompositeTiles([20, 35, 31, 43])).toThrow(/ceiling/);
  });

  it("rejects a nonsensical cap", () => {
    expect(() => planCompositeTiles(KILADHA, 0)).toThrow(/positive/);
  });

  it("keeps the ceiling above a full 3x3 of maximal tiles", () => {
    expect(MAX_COMPOSITE_PIXELS).toBeGreaterThanOrEqual((PROCESSING_API_MAX_SIDE_PX * 3) ** 2);
  });
});

/** Guards the invariant the merge depends on, over a spread of shapes. */
describe("planCompositeTiles invariants", () => {
  const cases: Array<[string, BBox, number]> = [
    ["kiladha at a tiny cap", KILADHA, 37],
    ["wide at a tiny cap", WIDE, 91],
    ["big at the real cap", BIG, PROCESSING_API_MAX_SIDE_PX],
  ];

  for (const [name, bbox, cap] of cases) {
    it(`covers every pixel exactly once — ${name}`, () => {
      const plan: CompositeTilePlan = planCompositeTiles(bbox, cap);
      const covered = new Uint8Array(plan.width * plan.height);
      for (const tile of plan.tiles) {
        for (let row = 0; row < tile.height; row++) {
          for (let col = 0; col < tile.width; col++) {
            covered[(tile.y + row) * plan.width + (tile.x + col)] += 1;
          }
        }
      }
      expect(covered.every((n) => n === 1)).toBe(true);
    });
  }
});

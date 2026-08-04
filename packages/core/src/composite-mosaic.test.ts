import { describe, expect, it } from "vitest";
import type { BBox } from "./bbox.js";
import { mergeCompositeTiles, type TileRaster } from "./composite-mosaic.js";
import { type CompositeTilePlan, planCompositeTiles } from "./composite-tiles.js";

const KILADHA: BBox = [23.105, 37.418, 23.14, 37.435];

/** A raster whose every pixel carries its own global index, so misplacement is visible. */
function indexedRaster(plan: CompositeTilePlan, index: number): TileRaster {
  const tile = plan.tiles[index];
  const ratio = new Float32Array(tile.width * tile.height);
  const sceneCount = new Float32Array(tile.width * tile.height);
  for (let row = 0; row < tile.height; row++) {
    for (let col = 0; col < tile.width; col++) {
      const global = (tile.y + row) * plan.width + (tile.x + col);
      ratio[row * tile.width + col] = global;
      sceneCount[row * tile.width + col] = index + 1;
    }
  }
  return { width: tile.width, height: tile.height, ratio, sceneCount };
}

function filled(width: number, height: number, value: number): TileRaster {
  return {
    width,
    height,
    ratio: new Float32Array(width * height).fill(value),
    sceneCount: new Float32Array(width * height).fill(value),
  };
}

describe("mergeCompositeTiles", () => {
  it("puts every pixel of a multi-tile plan at its global index", () => {
    // A small cap so the plan is several tiles without a large allocation.
    const plan = planCompositeTiles(KILADHA, 64);
    expect(plan.tiles.length).toBeGreaterThan(1);

    const merged = mergeCompositeTiles(
      plan,
      plan.tiles.map((_, i) => indexedRaster(plan, i)),
    );

    expect(merged.width).toBe(plan.width);
    expect(merged.height).toBe(plan.height);
    expect(merged.bbox).toEqual(plan.bbox);
    // Every pixel carries its own index, so one sweep proves the whole placement.
    for (let i = 0; i < merged.ratio.length; i++) {
      expect(merged.ratio[i]).toBe(i);
    }
  });

  it("keeps tiles apart — a seam pixel belongs to exactly one tile", () => {
    const plan = planCompositeTiles(KILADHA, 64);
    const merged = mergeCompositeTiles(
      plan,
      plan.tiles.map((_, i) => indexedRaster(plan, i)),
    );

    const second = plan.tiles[1];
    // The first pixel of the second tile must carry the second tile's marker, and the
    // pixel immediately to its left the first tile's.
    const at = (x: number, y: number) => merged.sceneCount[y * plan.width + x];
    expect(at(second.x, second.y)).toBe(2);
    expect(at(second.x - 1, second.y)).toBe(1);
  });

  it("passes a single tile straight through without copying", () => {
    const plan = planCompositeTiles(KILADHA);
    const raster = filled(plan.width, plan.height, 7);
    const merged = mergeCompositeTiles(plan, [raster]);

    expect(merged.ratio).toBe(raster.ratio);
    expect(merged.sceneCount).toBe(raster.sceneCount);
    expect(merged.bbox).toEqual(KILADHA);
  });

  it("throws when a raster is not the size it was asked for", () => {
    const plan = planCompositeTiles(KILADHA);
    const tile = plan.tiles[0];
    expect(() => mergeCompositeTiles(plan, [filled(tile.width + 1, tile.height, 0)])).toThrow(
      /Size mismatch/,
    );
  });

  it("names the offending tile by row and column", () => {
    const plan = planCompositeTiles(KILADHA, 64);
    const rasters = plan.tiles.map((_, i) => indexedRaster(plan, i));
    const broken = plan.tiles[2];
    rasters[2] = filled(broken.width, broken.height + 1, 0);

    expect(() => mergeCompositeTiles(plan, rasters)).toThrow(
      new RegExp(`tile 3 of ${plan.tiles.length} \\(row ${broken.row}, col ${broken.col}\\)`),
    );
  });

  it("throws when a band is the wrong length for its declared size", () => {
    const plan = planCompositeTiles(KILADHA);
    const tile = plan.tiles[0];
    expect(() =>
      mergeCompositeTiles(plan, [
        {
          width: tile.width,
          height: tile.height,
          ratio: new Float32Array(3),
          sceneCount: new Float32Array(tile.width * tile.height),
        },
      ]),
    ).toThrow(/Band length mismatch/);
  });

  it("throws when the number of rasters does not match the plan", () => {
    const plan = planCompositeTiles(KILADHA, 64);
    expect(() => mergeCompositeTiles(plan, [])).toThrow(/0 rasters/);
  });
});

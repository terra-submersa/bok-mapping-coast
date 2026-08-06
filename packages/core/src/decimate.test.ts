import { describe, expect, it } from "vitest";
import { gridToLonLat, type RatioGrid } from "./contour.js";
import { decimateGrid } from "./decimate.js";

function ramp(width: number, height: number): RatioGrid {
  const ratio = new Float32Array(width * height);
  const sceneCount = new Float32Array(width * height).fill(10);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) ratio[y * width + x] = x / width;
  }
  return { width, height, ratio, sceneCount, bbox: [23.1, 37.4, 23.2, 37.45] };
}

describe("decimateGrid", () => {
  it("returns the grid untouched below the cap", () => {
    const grid = ramp(40, 30);
    expect(decimateGrid(grid, 64)).toBe(grid);
  });

  it("brings the longest side under the cap", () => {
    const decimated = decimateGrid(ramp(4000, 1000), 1024);
    expect(Math.max(decimated.width, decimated.height)).toBeLessThanOrEqual(1024);
    expect(decimated.width).toBe(1000);
    expect(decimated.height).toBe(250);
  });

  /**
   * The half-block regression. `gridToLonLat` works in d3's cell-corner space, so a
   * decimated index has to land exactly where the source index it sampled did — get the
   * `(stride - 1) / 2` term wrong and every contour line sits half a block off the
   * raster underneath it.
   */
  it("puts a decimated cell centre exactly where the source cell centre was", () => {
    const source = ramp(400, 300);
    const decimated = decimateGrid(source, 100);
    const stride = 4;

    for (const [i, j] of [
      [0, 0],
      [1, 7],
      [50, 60],
      [decimated.width - 1, decimated.height - 1],
    ]) {
      const here = gridToLonLat(i + 0.5, j + 0.5, decimated);
      const there = gridToLonLat(i * stride + 0.5, j * stride + 0.5, source);
      expect(here[0]).toBeCloseTo(there[0], 12);
      expect(here[1]).toBeCloseTo(there[1], 12);
    }
  });

  it("decimates sceneCount alongside ratio, so a masked column stays masked", () => {
    const width = 200;
    const height = 200;
    const grid = ramp(width, height);
    const sceneCount = Float32Array.from(grid.sceneCount);
    // Every column the stride will land on, in the right half, is land.
    for (let y = 0; y < height; y++) {
      for (let x = width / 2; x < width; x++) sceneCount[y * width + x] = 0;
    }

    const decimated = decimateGrid({ ...grid, sceneCount }, 50);
    const half = decimated.width / 2;
    expect(decimated.sceneCount[0]).toBe(10);
    expect(decimated.sceneCount[half]).toBe(0);
    expect(decimated.sceneCount[decimated.width - 1]).toBe(0);
  });

  it("leaves the source arrays untouched", () => {
    const grid = ramp(300, 300);
    const before = Float32Array.from(grid.ratio as Float32Array);
    decimateGrid(grid, 50);
    expect(Float32Array.from(grid.ratio as Float32Array)).toEqual(before);
  });
});

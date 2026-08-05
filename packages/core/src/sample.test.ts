import { describe, expect, it } from "vitest";
import type { BBox } from "./bbox.js";
import { gridToLonLat, type RatioGrid } from "./contour.js";
import { lonLatToGrid, sampleRatio } from "./sample.js";

const BBOX: BBox = [23.0, 37.0, 23.4, 37.2];

/** A 4x2 grid. `ratio[i]` is the index itself, so a sample names the pixel it read. */
function grid(overrides: Partial<RatioGrid> = {}): RatioGrid {
  return {
    width: 4,
    height: 2,
    ratio: Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
    sceneCount: Float32Array.from([9, 9, 9, 9, 9, 9, 9, 9]),
    bbox: BBOX,
    ...overrides,
  };
}

describe("lonLatToGrid", () => {
  it("inverts gridToLonLat, which is the property that matters", () => {
    const g = grid();
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        // Pixel centres, not corners. If the two functions ever disagree about which
        // pixel a point is in, every calibration point reads the wrong ratio and
        // nothing on screen says so.
        //
        // Corners are deliberately not asserted: at a boundary the answer is decided by
        // the last bit of a division, and `gridToLonLat(3, 0)` on this grid comes back
        // as 23.299999999999997, which floors into pixel 2. Real soundings do not land
        // on pixel corners, and one pixel is well inside the ±3-5 m GPS error the 3x3
        // median exists to absorb.
        const [lon, lat] = gridToLonLat(x + 0.5, y + 0.5, g);
        expect(lonLatToGrid(lon, lat, g)).toEqual({ x, y });
      }
    }
  });

  it("puts row 0 at the north edge, as the merged raster does", () => {
    expect(lonLatToGrid(23.01, 37.19, grid())?.y).toBe(0);
    expect(lonLatToGrid(23.01, 37.01, grid())?.y).toBe(1);
  });

  it("returns null off the grid rather than clamping to the edge", () => {
    // Clamping would silently give a point in the next bay the ratio of this one's corner.
    expect(lonLatToGrid(22.9, 37.1, grid())).toBeNull();
    expect(lonLatToGrid(23.5, 37.1, grid())).toBeNull();
    expect(lonLatToGrid(23.1, 36.9, grid())).toBeNull();
    expect(lonLatToGrid(23.1, 37.5, grid())).toBeNull();
  });

  it("keeps a point exactly on the far edge inside the last pixel", () => {
    expect(lonLatToGrid(23.4, 37.0, grid())).toEqual({ x: 3, y: 1 });
  });
});

describe("sampleRatio", () => {
  it("takes the median of the window, not the single centre pixel", () => {
    // Centre is pixel 5 (row 1, col 1), whose own ratio is 5. Its 3x3 window clipped to
    // this two-row grid holds ratios {0,1,2,4,5,6}; the median of those six is 3.
    const [lon, lat] = gridToLonLat(1.5, 1.5, grid());
    const sample = sampleRatio(grid(), lon, lat);
    expect(sample?.ratio).toBeCloseTo(3, 9);
    expect(sample?.pixels).toBe(6);
  });

  it("ignores land in the window instead of averaging a zero in", () => {
    // Land carries ratio 0, which reads as the shallowest possible water; letting it
    // into the median would drag every fit toward the shore.
    const withLand = grid({ sceneCount: Float32Array.from([0, 0, 0, 9, 0, 9, 9, 9]) });
    const [lon, lat] = gridToLonLat(1.5, 1.5, withLand);
    const sample = sampleRatio(withLand, lon, lat);
    // Water pixels in the window are {5, 6} — indices 5 and 6, ratios 5 and 6.
    expect(sample?.ratio).toBeCloseTo(5.5, 9);
    expect(sample?.pixels).toBe(2);
  });

  it("ignores a non-finite ratio, same discipline as the contour (issue #44)", () => {
    const withNaN = grid({ ratio: Float32Array.from([0, 1, 2, 3, 4, Number.NaN, 6, 7]) });
    const [lon, lat] = gridToLonLat(1.5, 1.5, withNaN);
    expect(sampleRatio(withNaN, lon, lat)?.pixels).toBe(5);
  });

  it("returns null when nothing in the window is water", () => {
    const allLand = grid({ sceneCount: Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0]) });
    const [lon, lat] = gridToLonLat(1.5, 1.5, allLand);
    // Not a zero: a sounding over land has no ratio, and a zero would be the shallowest
    // reading in the set.
    expect(sampleRatio(allLand, lon, lat)).toBeNull();
  });

  it("returns null off the grid", () => {
    expect(sampleRatio(grid(), 22.0, 37.1)).toBeNull();
  });

  it("reports the scene count, so a fit on thin data is visible as such", () => {
    const thin = grid({ sceneCount: Float32Array.from([1, 1, 1, 1, 40, 40, 40, 40]) });
    const [lon, lat] = gridToLonLat(1.5, 1.5, thin);
    // Window is {0,1,2,4,5,6}: three at 1 and three at 40, median 20.5.
    expect(sampleRatio(thin, lon, lat)?.sceneCount).toBeCloseTo(20.5, 9);
  });

  it("reads a single pixel when asked for a window of one", () => {
    const [lon, lat] = gridToLonLat(1.5, 1.5, grid());
    const sample = sampleRatio(grid(), lon, lat, 1);
    expect(sample).toEqual({ ratio: 5, sceneCount: 9, pixels: 1 });
  });
});

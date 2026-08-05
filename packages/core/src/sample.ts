import type { RatioGrid } from "./contour.js";

/**
 * Reading the composite at a point — the other half of `gridToLonLat` (issue #12).
 *
 * Everything else in the pipeline goes raster → geometry. Calibration is the one thing
 * that goes the other way: a boat was *here*, and the question is what the satellite
 * says about here.
 */

/** Pixel coordinates, or null when the point is off the grid. Mirrors `gridToLonLat`. */
export function lonLatToGrid(
  lon: number,
  lat: number,
  grid: RatioGrid,
): { x: number; y: number } | null {
  const [minLon, minLat, maxLon, maxLat] = grid.bbox;
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return null;

  // Row 0 is the north edge, so latitude decreases with y — the same convention
  // `gridToLonLat` writes, and the one the merged raster is built on.
  const x = Math.floor(((lon - minLon) / (maxLon - minLon)) * grid.width);
  const y = Math.floor(((maxLat - lat) / (maxLat - minLat)) * grid.height);

  // A point exactly on the east or south edge lands one past the last pixel.
  return { x: Math.min(x, grid.width - 1), y: Math.min(y, grid.height - 1) };
}

export interface RatioSample {
  /** Median Stumpf ratio over the water pixels in the window. */
  ratio: number;
  /** Median scene count over the same pixels — how well supported the reading is. */
  sceneCount: number;
  /** How many pixels in the window were water. The window's size bounds it. */
  pixels: number;
}

/** Window side length. Odd, so the sounding's own pixel is the centre. */
const DEFAULT_WINDOW = 3;

/**
 * The composite's ratio at a sounding, as the median of a small window.
 *
 * A window rather than one pixel because of what the two error budgets are. A handheld
 * GPS fix is good to ±3–5 m and a Sentinel-2 pixel is 10 m across, so which pixel a
 * sounding "is" is already uncertain by about one pixel — and a single read would hand
 * that uncertainty straight to the fit. A 3×3 median over 30 m is the same order as the
 * positional error, and being a median it also survives one glinted pixel.
 *
 * Returns null when the point is off the grid, or when no pixel in the window is water.
 * Deliberately not a zero: land carries `ratio 0`, which reads as the shallowest possible
 * water and would drag the whole fit if it reached it. The same discipline `contour.ts`
 * applies (issue #44) — no data is not a value.
 */
export function sampleRatio(
  grid: RatioGrid,
  lon: number,
  lat: number,
  window: number = DEFAULT_WINDOW,
): RatioSample | null {
  const centre = lonLatToGrid(lon, lat, grid);
  if (!centre) return null;

  const radius = Math.floor(window / 2);
  const ratios: number[] = [];
  const counts: number[] = [];

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = centre.x + dx;
      const y = centre.y + dy;
      if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) continue;

      const index = y * grid.width + x;
      const sceneCount = grid.sceneCount[index];
      const ratio = grid.ratio[index];
      if (sceneCount > 0 && Number.isFinite(ratio)) {
        ratios.push(ratio);
        counts.push(sceneCount);
      }
    }
  }

  if (ratios.length === 0) return null;
  return { ratio: median(ratios), sceneCount: median(counts), pixels: ratios.length };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  // An even count averages the two middle values, so a 2-pixel window does not silently
  // prefer the deeper of the pair.
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

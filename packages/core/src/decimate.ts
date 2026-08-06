import type { RatioGrid } from "./contour.js";

/**
 * Longest side of the grid the depth-contour stack actually walks.
 *
 * Contouring forty levels means forty marching-squares passes, and a tiled composite
 * (issue #41) can be 7500 px across — a few million cells each time, on the main
 * thread, with the map frozen. Capping the side at 1024 caps the work at ~1 M cells
 * per level.
 *
 * The same argument `MAX_DISPLAY_SIDE` already makes for the raster canvas, and the
 * same caveat applies: only the *display* is resampled. `shallowWaterContour`,
 * `landMask` and `coastalRibbon` keep reading the full native grid, so nothing about
 * the exported boundary is decimated (issue #51).
 */
export const MAX_CONTOUR_SIDE = 1024;

/**
 * Nearest-neighbour subsample of a grid, keeping the georeferencing exact.
 *
 * The bbox has to be recomputed and this is the easy thing to get wrong. `gridToLonLat`
 * works in d3-contour's coordinate space, where cell `x` spans `[x, x + 1]` and its
 * centre is at `x + 0.5`. Sampling source cell `i · stride` for decimated cell `i`
 * therefore needs the decimated bbox to satisfy
 *
 *     minLon' + (i + 0.5) · stride · cellLon = minLon + (i · stride + 0.5) · cellLon
 *
 * i.e. the origin moves back by half a block, `(stride − 1) / 2` source cells, because
 * a decimated cell centred on the block's *first* pixel reaches half a block further
 * west and north than the source grid did. Drop that term and every contour line sits
 * up to half a block — tens of metres — off the raster underneath it, which is the kind
 * of error nobody notices until they are on the beach.
 *
 * Below the cap the stride is 1 and the grid is returned untouched.
 */
export function decimateGrid(grid: RatioGrid, maxSide = MAX_CONTOUR_SIDE): RatioGrid {
  const stride = Math.max(1, Math.ceil(Math.max(grid.width, grid.height) / maxSide));
  if (stride === 1) return grid;

  const width = Math.ceil(grid.width / stride);
  const height = Math.ceil(grid.height / stride);
  const ratio = new Float32Array(width * height);
  const sceneCount = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const sourceRow = y * stride * grid.width;
    for (let x = 0; x < width; x++) {
      const source = sourceRow + x * stride;
      const target = y * width + x;
      ratio[target] = grid.ratio[source];
      sceneCount[target] = grid.sceneCount[source];
    }
  }

  const [minLon, , maxLon, maxLat] = grid.bbox;
  const cellLon = (maxLon - minLon) / grid.width;
  const cellLat = (maxLat - grid.bbox[1]) / grid.height;
  const halfBlock = (stride - 1) / 2;

  // Row 0 is the north edge, so latitude counts *down* from the top and the half-block
  // shift moves the northern edge outward rather than the southern one.
  const west = minLon - halfBlock * cellLon;
  const north = maxLat + halfBlock * cellLat;

  return {
    width,
    height,
    ratio,
    sceneCount,
    bbox: [west, north - height * stride * cellLat, west + width * stride * cellLon, north],
  };
}

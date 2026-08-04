import type { BBox } from "./bbox.js";
import { checkProcessingApiLimit, PROCESSING_API_MAX_SIDE_PX } from "./processing-limit.js";

/**
 * Ceiling on the merged raster, in pixels. Not an API limit — a memory one. The two
 * FLOAT32 bands alone cost 8 bytes a pixel, so this is roughly 480 MB before the
 * display path has allocated anything, and it admits a full 3x3 of maximal tiles.
 *
 * An engineering estimate rather than a measured one. If a real large AOI shows the
 * browser giving out earlier, this comes down.
 */
export const MAX_COMPOSITE_PIXELS = 60_000_000;

export interface CompositeTile {
  /** Geographic extent of this tile alone. */
  bbox: BBox;
  /** Exact pixels to request. Never more than the plan's `maxSidePx`. */
  width: number;
  height: number;
  /** Pixel offset of this tile's north-west corner within the parent grid. */
  x: number;
  y: number;
  /** Position in the tile grid, for error messages the Planner can act on. */
  col: number;
  row: number;
}

export interface CompositeTilePlan {
  /** The parent envelope, unchanged. */
  bbox: BBox;
  /** Total size of the merged grid. */
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** Row-major, north-west first — the same order as the merged grid's rows. */
  tiles: CompositeTile[];
}

/** Splits `total` into `parts` integers that sum to exactly `total`, largest first. */
function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Slices an AOI envelope into sub-requests that each fit inside the Processing API's
 * single-request cap (issue #41).
 *
 * The order matters and is the whole trick. The obvious approach — cut the *bbox* into
 * sub-boxes and let each come back at whatever `nativeOutputSize` derives — does not
 * mosaic: that function rounds independently per tile and measures width along each
 * tile's own southern edge by great-circle distance, so two tiles in different rows can
 * differ by a pixel. Sub-pixel seams and off-by-one column counts follow.
 *
 * So the *pixel grid* is computed once and cut instead, and each tile's bbox is derived
 * from its exact pixel bounds. The caller then dictates `width`/`height` per tile and the
 * merge is a plain row-wise copy.
 *
 * This is consistent by construction with how the raster is already read: `gridToLonLat`
 * interpolates linearly over the bbox with row 0 at the north edge. Tiling introduces no
 * error that a single request does not already carry.
 */
export function planCompositeTiles(
  bbox: BBox,
  maxSidePx: number = PROCESSING_API_MAX_SIDE_PX,
): CompositeTilePlan {
  if (!Number.isFinite(maxSidePx) || maxSidePx < 1) {
    throw new Error(`maxSidePx must be a positive number, got ${maxSidePx}.`);
  }

  // Reuse the existing estimator rather than re-deriving it, so a plan of one tile is
  // guaranteed to agree with what `nativeOutputSize` would have asked for on its own.
  const { widthPx, heightPx } = checkProcessingApiLimit(bbox);
  const width = Math.max(1, Math.round(widthPx));
  const height = Math.max(1, Math.round(heightPx));

  if (width * height > MAX_COMPOSITE_PIXELS) {
    throw new Error(
      `AOI is ${width}x${height} px at 10 m (${(width * height) / 1e6} Mpx), over the ` +
        `${MAX_COMPOSITE_PIXELS / 1e6} Mpx ceiling. Draw a smaller area.`,
    );
  }

  const cols = Math.ceil(width / maxSidePx);
  const rows = Math.ceil(height / maxSidePx);
  const colWidths = splitEvenly(width, cols);
  const rowHeights = splitEvenly(height, rows);

  const [minLon, minLat, maxLon, maxLat] = bbox;
  // Pinned at the edges rather than interpolated there. `minLon + (width/width)*(maxLon -
  // minLon)` is not exactly `maxLon` in floating point, and a one-ulp drift would give a
  // single-tile plan a bbox that differs from its parent — which would miss every
  // existing cache entry, since the key is the JSON of the raw floats.
  const lonAt = (x: number) =>
    x === 0 ? minLon : x === width ? maxLon : minLon + (x / width) * (maxLon - minLon);
  const latAt = (y: number) =>
    y === 0 ? maxLat : y === height ? minLat : maxLat - (y / height) * (maxLat - minLat);

  const tiles: CompositeTile[] = [];
  let y = 0;
  for (let row = 0; row < rows; row++) {
    const tileHeight = rowHeights[row];
    let x = 0;
    for (let col = 0; col < cols; col++) {
      const tileWidth = colWidths[col];
      tiles.push({
        // North-west to south-east: latAt decreases with y, so y is the top edge.
        bbox: [lonAt(x), latAt(y + tileHeight), lonAt(x + tileWidth), latAt(y)],
        width: tileWidth,
        height: tileHeight,
        x,
        y,
        col,
        row,
      });
      x += tileWidth;
    }
    y += tileHeight;
  }

  return { bbox, width, height, cols, rows, tiles };
}

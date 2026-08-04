import type { BBox } from "./bbox.js";
import type { CompositeTilePlan } from "./composite-tiles.js";

/** One tile's decoded bands, as they come back from the Processing API. */
export interface TileRaster {
  width: number;
  height: number;
  ratio: Float32Array;
  sceneCount: Float32Array;
}

export interface MergedComposite {
  width: number;
  height: number;
  ratio: Float32Array;
  sceneCount: Float32Array;
  bbox: BBox;
}

function describe(plan: CompositeTilePlan, index: number): string {
  const tile = plan.tiles[index];
  return `tile ${index + 1} of ${plan.tiles.length} (row ${tile.row}, col ${tile.col})`;
}

/**
 * Stitches the tiles of a plan back into one raster (issue #41).
 *
 * `rasters` is parallel to `plan.tiles`. Because the plan cut the pixel grid rather than
 * the bbox, every tile lands on an exact integer offset and this is a row-wise copy —
 * no resampling, no interpolation, no seam arithmetic.
 *
 * Dimension mismatches throw rather than being absorbed. A raster that is not the size it
 * was asked for means the API ignored the explicit output size, and the alternative to
 * failing here is a mosaic that is silently skewed by a pixel per tile — which looks
 * entirely plausible on screen and would be found, if at all, weeks later.
 */
export function mergeCompositeTiles(
  plan: CompositeTilePlan,
  rasters: TileRaster[],
): MergedComposite {
  if (rasters.length !== plan.tiles.length) {
    throw new Error(`Plan has ${plan.tiles.length} tiles but ${rasters.length} rasters arrived.`);
  }

  for (let i = 0; i < rasters.length; i++) {
    const tile = plan.tiles[i];
    const raster = rasters[i];
    if (raster.width !== tile.width || raster.height !== tile.height) {
      throw new Error(
        `Size mismatch on ${describe(plan, i)}: asked for ${tile.width}x${tile.height}, ` +
          `got ${raster.width}x${raster.height}.`,
      );
    }
    const expected = tile.width * tile.height;
    if (raster.ratio.length !== expected || raster.sceneCount.length !== expected) {
      throw new Error(
        `Band length mismatch on ${describe(plan, i)}: expected ${expected} values, got ` +
          `${raster.ratio.length} ratio and ${raster.sceneCount.length} sceneCount.`,
      );
    }
  }

  // One tile is the overwhelmingly common case (any AOI that worked before #41), and the
  // copy would be a pointless second allocation of the whole raster.
  if (plan.tiles.length === 1) {
    const [only] = rasters;
    return {
      width: plan.width,
      height: plan.height,
      ratio: only.ratio,
      sceneCount: only.sceneCount,
      bbox: plan.bbox,
    };
  }

  const ratio = new Float32Array(plan.width * plan.height);
  const sceneCount = new Float32Array(plan.width * plan.height);

  for (let i = 0; i < rasters.length; i++) {
    const tile = plan.tiles[i];
    const raster = rasters[i];
    for (let row = 0; row < tile.height; row++) {
      const src = row * tile.width;
      const dst = (tile.y + row) * plan.width + tile.x;
      ratio.set(raster.ratio.subarray(src, src + tile.width), dst);
      sceneCount.set(raster.sceneCount.subarray(src, src + tile.width), dst);
    }
  }

  return { width: plan.width, height: plan.height, ratio, sceneCount, bbox: plan.bbox };
}

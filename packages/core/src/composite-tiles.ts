import {
  feature,
  featureCollection,
  bbox as turfBbox,
  buffer as turfBuffer,
  intersect as turfIntersect,
} from "@turf/turf";
import { aoiEnvelope, rectangleAoi } from "./aoi.js";
import type { BBox } from "./bbox.js";
import type { Polygonal } from "./polygonal.js";
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
  /**
   * The grid the plan was cut from. A coverage plan (`planCompositeCoverage`) does not
   * fill that grid: `rows` is its strip count and `cols` the tile count of its widest
   * strip, so `cols * rows` is an upper bound on `tiles.length` rather than its value.
   */
  cols: number;
  rows: number;
  /** Row-major, north-west first — the same order as the merged grid's rows. */
  tiles: CompositeTile[];
  /**
   * Pixels this plan actually requests, which is what the Processing API bills for.
   * Equal to `width * height` unless strips were dropped for falling outside the AOI.
   */
  coveredPx: number;
}

/**
 * The lon/lat of a pixel edge within a grid laid over `bbox`.
 *
 * Pinned at the edges rather than interpolated there. `minLon + (width/width)*(maxLon -
 * minLon)` is not exactly `maxLon` in floating point, and a one-ulp drift would give a
 * single-tile plan a bbox that differs from its parent — which would miss every existing
 * cache entry, since the key is the JSON of the raw floats.
 */
function gridEdges(bbox: BBox, width: number, height: number) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return {
    lonAt: (x: number) =>
      x === 0 ? minLon : x === width ? maxLon : minLon + (x / width) * (maxLon - minLon),
    latAt: (y: number) =>
      y === 0 ? maxLat : y === height ? minLat : maxLat - (y / height) * (maxLat - minLat),
  };
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

  const { lonAt, latAt } = gridEdges(bbox, width, height);

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

  return { bbox, width, height, cols, rows, tiles, coveredPx: width * height };
}

/**
 * Height of one coverage strip, in pixels of the parent grid — 5.12 km at Sentinel-2's
 * 10 m bands.
 *
 * The knob that trades money against waiting. Shorter strips hug a diagonal AOI more
 * tightly and fetch fewer pixels, but each strip is its own metered request paying the
 * fixed cost of a temporal median over a summer of scenes. Measured on a real 38x18 km
 * diagonal AOI (issue #46): 512 px fetches 67% of the envelope in 6 requests, 256 px
 * fetches 59% in 10, 128 px fetches 53% in 18. The floor for any scheme built from
 * rectangles is the polygon's own fill fraction — 42% for that AOI.
 */
export const COMPOSITE_STRIP_PX = 512;

/**
 * How far outside the AOI a strip is still fetched.
 *
 * **Coupled to the coast-distance slider's maximum (100 m in `BufferPanel`), and the
 * coupling is the point.** Pixels nobody requested arrive as `sceneCount = 0`, which
 * `landMask` reads as land — so the staircase edge between fetched and unfetched ground
 * is a fake coastline, and `coastalRibbon` grows a band inward from it. That is issue
 * #32's failure arriving by a new road. Keeping the fake coast further out than the
 * ribbon can reach means the band never survives the clip to the AOI. Raise the slider's
 * maximum above this and the ribbon comes back.
 */
export const COVERAGE_MARGIN_M = 200;

/**
 * How much a coverage plan must save before it is worth using. Below this the plain
 * envelope plan wins: it is fewer requests, and for an AOI that already fits in one it
 * keeps the cache key — and so every composite already on disk — intact.
 */
export const MIN_COVERAGE_SAVING = 0.15;

export interface CoveragePlanOptions {
  stripPx?: number;
  marginMetres?: number;
  maxSidePx?: number;
  minSaving?: number;
}

/** Merges overlapping or touching `[start, end)` column runs, left to right. */
function mergeRuns(runs: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...runs].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** The parts of a polygonal geometry, each as its own polygon. */
function parts(geometry: Polygonal): GeoJSON.Polygon[] {
  if (geometry.type === "Polygon") return [geometry];
  return geometry.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
}

/**
 * Plans the composite for an AOI as horizontal strips that follow the polygon, instead of
 * the full envelope its corners imply (issue #46).
 *
 * The saving is the whole reason this exists. The Processing API is metered by output
 * pixels, and the AOIs this project draws are diagonal coastal bands whose envelope is
 * mostly open sea and hillside — 58% of it, on the first real AOI measured. Fetching that
 * is money spent on water nobody will fly over.
 *
 * **The polygon still never reaches the API.** Every request is an axis-aligned box, as
 * CLAUDE.md requires: send the geometry as `bounds.geometry` and the masked pixels come
 * back as no-data, `landMask` reads them as land, and a coastal ribbon grows along the AOI
 * edge. All this does is ask for fewer, better-placed boxes.
 *
 * Why strips and not a fine grid: within one strip of a diagonal AOI, the columns the
 * polygon occupies are a narrow run, so a strip is nearly as tight as a grid an eighth of
 * its size and costs a fraction of the requests. On the measured AOI, 512 px strips fetch
 * 67% of the envelope in 6 requests where a 128 px grid fetches 55% in 420.
 *
 * Every strip is cut from the *parent* pixel grid, exactly as `planCompositeTiles` cuts
 * its tiles, so the merge stays a row-wise copy at integer offsets. Pixels no strip covers
 * are simply never written, and `Float32Array` leaves them 0 — which every consumer
 * already treats as no-data, since `sceneCount` 0 is what land and cloud produce too.
 *
 * Falls back to the plain envelope plan when the saving is not worth the extra requests,
 * which keeps a rectangle-ish AOI on the single request it has always used.
 */
export function planCompositeCoverage(
  aoi: Polygonal,
  {
    stripPx = COMPOSITE_STRIP_PX,
    marginMetres = COVERAGE_MARGIN_M,
    maxSidePx = PROCESSING_API_MAX_SIDE_PX,
    minSaving = MIN_COVERAGE_SAVING,
  }: CoveragePlanOptions = {},
): CompositeTilePlan {
  // Also does the memory-ceiling check and fixes the parent grid, so a coverage plan can
  // never disagree with the envelope plan about how big the merged raster is.
  const envelopePlan = planCompositeTiles(aoiEnvelope(aoi), maxSidePx);
  const { bbox, width, height } = envelopePlan;

  const margin = turfBuffer(aoi, marginMetres, { units: "meters" });
  if (!margin) return envelopePlan;

  const { lonAt, latAt } = gridEdges(bbox, width, height);
  const [minLon, maxLon] = [bbox[0], bbox[2]];
  const toColumn = (lon: number) => ((lon - minLon) / (maxLon - minLon)) * width;

  const stripHeight = Math.max(1, Math.min(Math.floor(stripPx), maxSidePx));
  const rows = Math.ceil(height / stripHeight);
  const rowHeights = splitEvenly(height, rows);

  const tiles: CompositeTile[] = [];
  let widestStrip = 0;
  let y = 0;

  for (let row = 0; row < rows; row++) {
    const tileHeight = rowHeights[row];
    const strip = rectangleAoi([bbox[0], latAt(y + tileHeight), bbox[2], latAt(y)]);
    const covered = turfIntersect(
      featureCollection<Polygonal>([feature(margin.geometry), feature(strip)]),
    );

    if (covered) {
      const runs = mergeRuns(
        parts(covered.geometry).map((part) => {
          const [partMinLon, , partMaxLon] = turfBbox(part);
          // Snapped outward: a partly covered pixel column is fetched, never dropped.
          const start = Math.max(0, Math.min(width - 1, Math.floor(toColumn(partMinLon))));
          const end = Math.min(width, Math.max(start + 1, Math.ceil(toColumn(partMaxLon))));
          return [start, end] as [number, number];
        }),
      );

      let col = 0;
      for (const [start, end] of runs) {
        const chunks = splitEvenly(end - start, Math.ceil((end - start) / maxSidePx));
        let x = start;
        for (const tileWidth of chunks) {
          tiles.push({
            bbox: [lonAt(x), latAt(y + tileHeight), lonAt(x + tileWidth), latAt(y)],
            width: tileWidth,
            height: tileHeight,
            x,
            y,
            col,
            row,
          });
          x += tileWidth;
          col++;
        }
      }
      widestStrip = Math.max(widestStrip, col);
    }

    y += tileHeight;
  }

  const coveredPx = tiles.reduce((total, tile) => total + tile.width * tile.height, 0);
  if (tiles.length === 0 || coveredPx > (1 - minSaving) * width * height) return envelopePlan;

  return { bbox, width, height, cols: widestStrip, rows, tiles, coveredPx };
}

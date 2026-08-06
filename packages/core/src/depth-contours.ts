import { contours } from "d3-contour";
import { type ContourOptions, EXCLUDED, gridToLonLat, type RatioGrid } from "./contour.js";
import { type DepthFit, depthToRatio, isUsableFit, ratioToDepth } from "./depth-fit.js";
import { type Polygonal, toMultiPolygon } from "./polygonal.js";
import { simplifyLines } from "./simplify.js";
import type { Range } from "./stretch.js";

/**
 * A stack of depth contour lines over the AOI (issue #51).
 *
 * This is a *read of the seabed*, not part of the exported boundary. Nothing here is
 * consumed by `useBoundary` or by the KML writer, and nothing here knows about
 * exclusion or inclusion zones — those shape a mission, not the bathymetry.
 */

/** What the header menu offers. Metres, because a contour interval is only ever metres. */
export const DEPTH_CONTOUR_INTERVALS_M = [0.5, 1, 2, 5] as const;

/**
 * Ceiling on how many lines are drawn at once. Forty marching-squares passes is already
 * the bulk of the work, and forty stacked isolines is already at the edge of legible.
 */
export const MAX_DEPTH_CONTOUR_LEVELS = 40;

export interface DepthContourLevel {
  depthM: number;
  /** The Stumpf ratio that depth corresponds to under the current fit. */
  ratio: number;
}

export interface DepthContourPlan {
  /** Shallowest first. Empty whenever metres are not permissible (D3). */
  levels: DepthContourLevel[];
  /** How many multiples of the interval the range holds, before the cap. */
  availableCount: number;
  /** True when the cap dropped the deep end. */
  capped: boolean;
  /** Depth extent of the water present, for the UI to quote. Null without a usable fit. */
  extentM: { min: number; max: number } | null;
}

export interface PlanDepthContoursOptions {
  maxLevels?: number;
}

const EMPTY_PLAN: DepthContourPlan = {
  levels: [],
  availableCount: 0,
  capped: false,
  extentM: null,
};

/**
 * Multiples of `intervalM` that fall inside the water this composite actually shows.
 *
 * The whole D3 gate lives in `isUsableFit`: without three calibration points and a
 * positive slope there are no metres, so there are no levels and the UI has to say why
 * rather than drawing confidently-labelled nonsense.
 *
 * When the cap bites, the *shallowest* levels are kept rather than a thinned selection.
 * A menu that says "0.5 m" while drawing lines 2 m apart is exactly the quiet lie D3
 * exists to prevent — and shallow water is what this app is about.
 */
export function planDepthContours(
  fit: DepthFit | null,
  ratioRange: Range | null,
  intervalM: number,
  { maxLevels = MAX_DEPTH_CONTOUR_LEVELS }: PlanDepthContoursOptions = {},
): DepthContourPlan {
  if (!isUsableFit(fit) || !ratioRange) return EMPTY_PLAN;
  if (!Number.isFinite(ratioRange.min) || !Number.isFinite(ratioRange.max)) return EMPTY_PLAN;

  const low = ratioToDepth(fit, ratioRange.min);
  const high = ratioToDepth(fit, ratioRange.max);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return EMPTY_PLAN;
  const extentM = { min: Math.min(low, high), max: Math.max(low, high) };

  // The extent is worth reporting even with the menu switched off — it is what the
  // "no whole multiple falls in range" message quotes.
  if (!Number.isFinite(intervalM) || intervalM <= 0) return { ...EMPTY_PLAN, extentM };

  /*
   * Nudged by a relative epsilon so an endpoint that *is* a multiple survives the
   * arithmetic that produced it: `ratioToDepth` rarely lands on 3 rather than
   * 3.0000000000000004, and `ceil` would silently drop that line.
   */
  const epsilon = 1e-9;
  const kMax = Math.floor(extentM.max / intervalM + epsilon);
  // A poor fit puts the shallow end above the waterline, and "−1 m" is not a depth.
  const kMin = Math.max(1, Math.ceil(extentM.min / intervalM - epsilon));

  const availableCount = Math.max(0, kMax - kMin + 1);
  const capped = availableCount > maxLevels;
  const kEnd = capped ? kMin + maxLevels - 1 : kMax;

  const levels: DepthContourLevel[] = [];
  for (let k = kMin; k <= kEnd; k++) {
    // Two decimals kills the float dust, so a 0.5 m interval yields 1.5 and not
    // 1.5000000000000002 — which would reach the map as a label.
    const depthM = Math.round(k * intervalM * 100) / 100;
    const ratio = depthToRatio(fit, depthM);
    if (ratio === null || !Number.isFinite(ratio)) continue;
    levels.push({ depthM, ratio });
  }

  return { levels, availableCount, capped, extentM };
}

export interface DepthContourLine {
  depthM: number;
  geometry: GeoJSON.MultiLineString;
}

/**
 * Box-blur radius, in pixels, that makes a contour of this raster legible.
 *
 * Measured on a real Kiladha composite, one level, decimated to 953×890: unsmoothed the
 * level breaks into ~800 fragments and takes ~810 ms; at radius 2 it is ~126 fragments
 * and ~28 ms. Both halves of that matter and the first is the important one — 800
 * fragments is a hairball, not a contour map.
 *
 * The speed is a consequence rather than the goal. d3's `contour` assigns each hole to a
 * polygon by scanning every polygon, which is quadratic in ring count, so pixel noise
 * costs far more than pixels do. Smoothing removes the rings; the marching squares was
 * never the expensive part.
 */
export const DEFAULT_CONTOUR_SMOOTH_RADIUS_PX = 2;

export interface DepthContourOptions extends ContourOptions {
  /** Applied as a pixel mask before contouring, not as a polygon clip. See below. */
  aoi?: Polygonal;
  /**
   * Box-blur radius in pixels applied to the ratio before contouring. 0 disables.
   * `DEFAULT_CONTOUR_SMOOTH_RADIUS_PX` explains why anything drawing a real composite
   * wants this on.
   */
  smoothRadius?: number;
  /** Douglas-Peucker tolerance in metres. 0 disables. */
  simplifyMetres?: number;
  /** Fragments shorter than this are dropped as speckle. The line analogue of MIN_RING_AREA_M2. */
  minLengthM?: number;
}

/**
 * One `MultiLineString` per level, in the order given.
 *
 * ## Why lines and not the bands d3 returns
 *
 * d3-contour yields the filled region where `ratio <= ratio(level)`. The outline of
 * that region is two different things spliced together: the genuine isoline, between
 * two water pixels, and runs along the **mask boundary** — the coastline, no-data, the
 * grid's own rectangle, and the AOI edge. Near shore the water is shallower than every
 * level, so all N bands share the same coastline run: N coincident strands, each one
 * ready to take a depth label on the beach.
 *
 * So each ring is cut into maximal runs of vertices that are *not* mask-adjacent. That
 * is the step that removes those runs, and it also means **the AOI is applied by
 * masking the field rather than by clipping the geometry** — one mechanism for both,
 * and no per-level `intersect` over multi-thousand-vertex polygons.
 *
 * A pleasant consequence: band nesting (1 m ⊂ 2 m ⊂ …) and the holes d3 assigns stop
 * mattering entirely, because a hole is just another ring once every ring is a
 * polyline.
 *
 * ## Smoothed, and it has to be said out loud
 *
 * With `smoothRadius` on, these lines trace a blurred ratio field. That is ordinary
 * cartographic practice for a noisy surface and it is what makes the result readable —
 * but it means a contour is a *reading of the seabed's shape*, not a measurement of
 * where a depth is. Nothing may be measured off it, which is exactly why nothing
 * downstream consumes it.
 */
export function depthContourLines(
  grid: RatioGrid,
  levels: readonly DepthContourLevel[],
  {
    minSceneCount = 1,
    aoi,
    smoothRadius = 0,
    simplifyMetres = 0,
    minLengthM = 0,
  }: DepthContourOptions = {},
): DepthContourLine[] {
  if (levels.length === 0) return [];

  const { width, height, ratio, sceneCount } = grid;
  const inside = aoi ? aoiMask(grid, aoi) : null;

  const live = new Uint8Array(width * height);
  let field: Float64Array = new Float64Array(width * height);
  for (let i = 0; i < field.length; i++) {
    // Same predicate as `shallowWaterContour`, so the two agree about where water is —
    // including the issue #44 rule that a non-finite ratio is excluded alongside land.
    const water =
      sceneCount[i] >= minSceneCount && Number.isFinite(ratio[i]) && (!inside || inside[i] === 1);
    live[i] = water ? 1 : 0;
    field[i] = water ? -ratio[i] : EXCLUDED;
  }
  // `live` is deliberately not blurred: smoothing changes the depths, never where the
  // water is. The coastline therefore stays exactly where `shallowWaterContour` puts it,
  // and the mask-boundary runs are still cut in the same places.
  if (smoothRadius > 0) field = blurLive(field, live, width, height, smoothRadius);

  /*
   * An explicit loop, deliberately. d3-contour's plural `contours(values)` is
   * `tz.map(value => contour(values, value))` — the same marching-squares pass per
   * level, plus a sort of the thresholds that would reverse our negated ones. It buys
   * nothing here, and positional pairing with `levels` is worth keeping.
   *
   * The ratio grows with depth while d3 returns regions at or above a value, so the
   * field is negated and so is each threshold — as in `shallowWaterContour`.
   */
  const values = field as unknown as number[];
  const generator = contours().size([width, height]);

  return levels.map((level) => {
    const band = generator.contour(values, -level.ratio);
    const coordinates: GeoJSON.Position[][] = [];
    for (const polygon of band.coordinates) {
      for (const ring of polygon) {
        for (const run of isolineRuns(ring as GeoJSON.Position[], live, width, height)) {
          coordinates.push(run.map(([x, y]) => gridToLonLat(x, y, grid)));
        }
      }
    }

    const kept =
      minLengthM > 0 ? coordinates.filter((l) => lineLengthM(l) >= minLengthM) : coordinates;
    return {
      depthM: level.depthM,
      geometry: simplifyLines({ type: "MultiLineString", coordinates: kept }, simplifyMetres),
    };
  });
}

/**
 * Box blur over live cells only.
 *
 * Averaging a masked cell in would drag the sentinel — or a land pixel's ratio of 0 —
 * into the water beside it and bend every level towards the shore. Cells that are not
 * live keep their sentinel untouched, so the mask is bit-identical afterwards.
 */
function blurLive(
  field: Float64Array,
  live: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Float64Array {
  const out = new Float64Array(field.length);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (live[index] === 0) {
        out[index] = field[index];
        continue;
      }
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      let sum = 0;
      let count = 0;
      for (let yy = top; yy <= bottom; yy++) {
        const row = yy * width;
        for (let xx = left; xx <= right; xx++) {
          if (live[row + xx] === 1) {
            sum += field[row + xx];
            count++;
          }
        }
      }
      out[index] = sum / count;
    }
  }
  return out;
}

/**
 * Cuts one band ring into the stretches that are genuine isoline.
 *
 * d3 works in a space where cell `(x, y)` spans `[x, x+1] × [y, y+1]`, so its centre is
 * at `(x + 0.5, y + 0.5)` and every ring vertex lies on a segment joining two adjacent
 * cell centres. `floor`/`ceil` of `coordinate − 0.5` therefore names exactly the two
 * cells that vertex straddles — no diagonal neighbours, so nothing is over-trimmed.
 *
 * A vertex whose straddled cells are all live is genuine isoline. One that straddles a
 * masked cell is the mask's own outline, and one that straddles off-grid is the
 * rectangle's edge; both are dropped.
 */
function isolineRuns(
  ring: GeoJSON.Position[],
  live: Uint8Array,
  width: number,
  height: number,
): GeoJSON.Position[][] {
  // d3 closes its rings; work on the open list so the closure point is not judged twice.
  const open = ring.slice(0, -1);
  const count = open.length;
  if (count === 0) return [];

  const keep = open.map(([x, y]) => isIsolineVertex(x, y, live, width, height));
  // Wholly interior: a genuine closed isoline, which keeps its closure point.
  if (keep.every(Boolean)) return [[...open, open[0]]];

  const start = keep.indexOf(false);
  const runs: GeoJSON.Position[][] = [];
  let current: GeoJSON.Position[] = [];
  // Walks the ring cyclically from a dropped vertex, so a run spanning the closure
  // point is one run and not two.
  for (let step = 1; step <= count; step++) {
    const index = (start + step) % count;
    if (keep[index]) {
      current.push(open[index]);
      continue;
    }
    if (current.length >= 2) runs.push(current);
    current = [];
  }
  if (current.length >= 2) runs.push(current);
  return runs;
}

function isIsolineVertex(
  vx: number,
  vy: number,
  live: Uint8Array,
  width: number,
  height: number,
): boolean {
  const x0 = Math.floor(vx - 0.5);
  const x1 = Math.ceil(vx - 0.5);
  const y0 = Math.floor(vy - 0.5);
  const y1 = Math.ceil(vy - 0.5);
  for (let y = y0; y <= y1; y++) {
    if (y < 0 || y >= height) return false;
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= width) return false;
      if (live[y * width + x] === 0) return false;
    }
  }
  return true;
}

/** Metres per degree of latitude, matching `simplify.ts`'s tolerance conversion. */
const METRES_PER_DEGREE = 111_320;

/**
 * Equirectangular length, good to a fraction of a percent over an AOI-sized line and
 * used only to compare against a speckle threshold. Turf's haversine would be exact and
 * would run over tens of thousands of fragments to decide the same thing.
 */
function lineLengthM(line: GeoJSON.Position[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const [lon1, lat1] = line[i - 1];
    const [lon2, lat2] = line[i];
    const dx = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
    const dy = lat2 - lat1;
    total += Math.hypot(dx, dy) * METRES_PER_DEGREE;
  }
  return total;
}

/**
 * Which pixels fall inside the AOI, by even-odd scanline.
 *
 * One pass per row over the ring edges, rather than a point-in-polygon call per pixel:
 * a million-pixel grid would otherwise spend more time deciding what is in the AOI than
 * contouring it. Even-odd also gets holes right for free.
 */
function aoiMask(grid: RatioGrid, aoi: Polygonal): Uint8Array {
  const { width, height } = grid;
  const [minLon, minLat, maxLon, maxLat] = grid.bbox;
  const spanLon = maxLon - minLon;
  const spanLat = maxLat - minLat;
  const mask = new Uint8Array(width * height);
  const rings = toMultiPolygon(aoi).coordinates.flat();
  if (rings.length === 0 || spanLon === 0 || spanLat === 0) return mask;

  const crossings: number[] = [];
  for (let y = 0; y < height; y++) {
    // The pixel's centre, which in d3's space sits at y + 0.5.
    const lat = maxLat - ((y + 0.5) / height) * spanLat;
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];
        // Half-open in latitude, so a vertex lying on the scanline counts once.
        if (y1 <= lat === y2 <= lat) continue;
        crossings.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);

    const row = y * width;
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(((crossings[k] - minLon) / spanLon) * width - 0.5));
      const to = Math.min(
        width - 1,
        Math.floor(((crossings[k + 1] - minLon) / spanLon) * width - 0.5),
      );
      for (let x = from; x <= to; x++) mask[row + x] = 1;
    }
  }
  return mask;
}

import { contours } from "d3-contour";
import type { BBox } from "./bbox.js";

export interface RatioGrid {
  width: number;
  height: number;
  /** Median Stumpf ratio per pixel. Higher means deeper. */
  ratio: ArrayLike<number>;
  /** Contributing scenes per pixel. 0 means land, cloud, or no data. */
  sceneCount: ArrayLike<number>;
  /** Geographic extent of the grid, row 0 being the northern edge. */
  bbox: BBox;
}

export interface ContourOptions {
  /** Pixels backed by fewer scenes than this are treated as not-water. */
  minSceneCount?: number;
}

/**
 * Sentinel standing in for "definitely not shallow water". Land pixels carry a
 * ratio of 0, which would otherwise read as the shallowest possible water and
 * pull the whole coastline into the survey polygon.
 */
const EXCLUDED = -1e9;

/**
 * Traces the boundary of water shallower than `threshold`.
 *
 * The Stumpf ratio increases with depth, so "shallow" is the region *below* the
 * threshold. d3-contour yields regions at or above a value, so the grid is
 * negated and so is the threshold.
 */
export function shallowWaterContour(
  grid: RatioGrid,
  threshold: number,
  { minSceneCount = 1 }: ContourOptions = {},
): GeoJSON.MultiPolygon {
  const { width, height, ratio, sceneCount } = grid;

  const negated = new Float64Array(width * height);
  for (let i = 0; i < negated.length; i++) {
    negated[i] = sceneCount[i] >= minSceneCount ? -ratio[i] : EXCLUDED;
  }

  // d3-contour is typed as number[] but only ever indexes and reads .length, so a
  // typed array works and avoids boxing ~60k values on every slider tick.
  const values = negated as unknown as number[];
  const multiPolygon = contours().size([width, height]).contour(values, -threshold);

  return {
    type: "MultiPolygon",
    coordinates: multiPolygon.coordinates.map((polygon) =>
      polygon.map((ring) => ring.map(([x, y]) => gridToLonLat(x, y, grid))),
    ),
  };
}

/** Grid coordinates to lon/lat. Row 0 is the north edge, so latitude decreases with y. */
function gridToLonLat(x: number, y: number, grid: RatioGrid): [number, number] {
  const [minLon, minLat, maxLon, maxLat] = grid.bbox;
  return [
    minLon + (x / grid.width) * (maxLon - minLon),
    maxLat - (y / grid.height) * (maxLat - minLat),
  ];
}

/** Total vertices across every ring — what Pilot 2 actually chokes on (story 4.2). */
export function countVertices(geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon): number {
  const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  return polygons.reduce(
    (total, polygon) => total + polygon.reduce((sum, ring) => sum + ring.length, 0),
    0,
  );
}

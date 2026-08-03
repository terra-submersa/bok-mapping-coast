import {
  bboxPolygon,
  feature,
  featureCollection,
  buffer as turfBuffer,
  difference as turfDifference,
  intersect as turfIntersect,
} from "@turf/turf";
import { contours } from "d3-contour";
import type { BBox } from "./bbox.js";
import type { ContourOptions, RatioGrid } from "./contour.js";
import { gridToLonLat } from "./contour.js";

/** What turf's boolean ops take and return: either polygonal geometry. */
type Polygonal = GeoJSON.Polygon | GeoJSON.MultiPolygon;

/**
 * Traces land: pixels with too few contributing scenes to call water at all.
 * This is the same `sceneCount` gate `shallowWaterContour` uses to keep land
 * out of the survey polygon, inverted — there is no coastline data source in
 * the repo, so this raster mask is the coastline proxy (issue #27). It also
 * catches permanent cloud and no-data pixels, which is an accepted limitation:
 * they get treated as "coast" too.
 */
export function landMask(
  grid: RatioGrid,
  { minSceneCount = 1 }: ContourOptions = {},
): GeoJSON.MultiPolygon {
  const { width, height, sceneCount } = grid;

  const isLand = new Float64Array(width * height);
  for (let i = 0; i < isLand.length; i++) {
    isLand[i] = sceneCount[i] >= minSceneCount ? 0 : 1;
  }

  const values = isLand as unknown as number[];
  const multiPolygon = contours().size([width, height]).contour(values, 0.5);

  return {
    type: "MultiPolygon",
    coordinates: multiPolygon.coordinates.map((polygon) =>
      polygon.map((ring) => ring.map(([x, y]) => gridToLonLat(x, y, grid))),
    ),
  };
}

/**
 * The water strip out to `metres` from the coastline, on the seaward side
 * only — a guaranteed-continuous band along the whole coastline, so a hole
 * in the depth contour (Posidonia misread as deep, glint, a cloudy patch)
 * doesn't break the flight boundary right next to shore, where
 * structure-from-motion needs it most (issue #27).
 *
 * Bounded by *water*, not merely by "not land" (issue #32). `land`'s boundary
 * is part real coastline and part an artificial cut where a landmass runs off
 * the edge of the AOI. Buffering outward across that cut and subtracting only
 * `land` pushed the band past the AOI, and the downstream clip then snapped it
 * back so the band closed along the AOI's edges — wrapping the landmass in an
 * annulus whose hole was the land itself. That looked survivable on the map,
 * where the hole renders, and was not in the export, where holes are dropped.
 *
 * Intersecting with `aoi - land` instead is one operation that gets all three
 * properties at once: seaward-only, never on land at any distance (whether
 * `land` is the mainland or an islet thinner than `metres`), and never outside
 * the AOI. Where a landmass is cut by the AOI the band becomes an open strip
 * that simply stops at the edge. An island wholly inside the AOI still yields
 * a genuine annulus, whose hole is real and whose loss at export is a decision
 * already taken (see `ContourRing`).
 *
 * Returns every disjoint piece of the band, not just the largest — one
 * landmass's ribbon must not swallow every other landmass's (issue #31).
 */
export function coastalRibbon(
  land: GeoJSON.MultiPolygon,
  metres: number,
  aoi: BBox,
): GeoJSON.MultiPolygon | null {
  if (metres <= 0 || land.coordinates.length === 0) return null;

  const outward = turfBuffer(land, metres, { units: "meters" });
  if (!outward) return null;

  const water = turfDifference(featureCollection<Polygonal>([bboxPolygon(aoi), feature(land)]));
  if (!water) return null;

  const band = turfIntersect(featureCollection<Polygonal>([feature(outward.geometry), water]));
  if (!band) return null;

  const { geometry } = band;
  return geometry.type === "Polygon"
    ? { type: "MultiPolygon", coordinates: [geometry.coordinates] }
    : geometry;
}

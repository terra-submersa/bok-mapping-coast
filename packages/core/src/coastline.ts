import {
  feature,
  featureCollection,
  buffer as turfBuffer,
  difference as turfDifference,
} from "@turf/turf";
import { contours } from "d3-contour";
import type { ContourOptions, RatioGrid } from "./contour.js";
import { gridToLonLat } from "./contour.js";

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
 * Never covers land, at any distance: subtracting `land` itself from its
 * own outward buffer leaves exactly the water-side band, whether `land` is
 * the mainland or a thin islet — no erosion, no special case for landmasses
 * thinner than `metres` (issue #31; an earlier version eroded `land` inward
 * and subtracted that instead, which left a band straddling the coast on
 * both sides).
 *
 * Returns every disjoint piece of the band, not just the largest — one
 * landmass's ribbon must not swallow every other landmass's (issue #31).
 * The result is only ever collapsed to a single polygon at the boundary's
 * very last step, same reasoning `unionPolygons` and `bufferPolygon` use.
 */
export function coastalRibbon(
  land: GeoJSON.MultiPolygon,
  metres: number,
): GeoJSON.MultiPolygon | null {
  if (metres <= 0 || land.coordinates.length === 0) return null;

  const outward = turfBuffer(land, metres, { units: "meters" });
  if (!outward) return null;

  const band = turfDifference(featureCollection([feature(outward.geometry), feature(land)]));
  if (!band) return null;

  const { geometry } = band;
  return geometry.type === "Polygon"
    ? { type: "MultiPolygon", coordinates: [geometry.coordinates] }
    : geometry;
}

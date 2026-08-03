import { buffer as turfBuffer, difference as turfDifference, feature, featureCollection } from "@turf/turf";
import { contours } from "d3-contour";
import type { ContourOptions, RatioGrid } from "./contour.js";
import { gridToLonLat } from "./contour.js";
import { largestPolygon } from "./rings.js";

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
 * A single simple polygon covering the coastline out to `metres` on both
 * sides of it (offshore and onshore) — a guaranteed-continuous strip along
 * the whole coastline, so a hole in the depth contour (Posidonia misread as
 * deep, glint, a cloudy patch) doesn't break the flight boundary right next
 * to shore, where structure-from-motion needs it most (issue #27).
 *
 * Bounded to a strip, not the whole landmass: `land` is one contiguous
 * polygon from the shore to wherever the AOI happens to end, so an
 * unbounded outward buffer of it would carry the boundary across the entire
 * inland portion of the AOI (issue #30) rather than hugging the coast.
 * Eroding `land` inward by the same distance and subtracting that from the
 * outward buffer leaves a band of the requested width straddling the coast;
 * a landmass thinner than `metres` (an islet, a spit) erodes away entirely,
 * so it stays included whole, same as before.
 *
 * The erosion leaves the excluded interior as a hole, which must be kept:
 * a landmass much bigger than `metres` (the mainland, not an islet) needs
 * that hole to stay out of the final boundary (issue #30). Only the
 * boundary's very last step drops holes, for the small ones the erosion
 * can't produce — the same reasoning `bufferPolygon` uses.
 */
export function coastalRibbon(land: GeoJSON.MultiPolygon, metres: number): GeoJSON.Polygon | null {
  if (metres <= 0 || land.coordinates.length === 0) return null;

  const outward = turfBuffer(land, metres, { units: "meters" });
  if (!outward) return null;

  const inward = turfBuffer(land, -metres, { units: "meters" });
  const band = inward
    ? turfDifference(featureCollection([feature(outward.geometry), feature(inward.geometry)]))
    : outward;
  if (!band) return null;

  const { geometry } = band;
  const multi: GeoJSON.MultiPolygon =
    geometry.type === "Polygon"
      ? { type: "MultiPolygon", coordinates: [geometry.coordinates] }
      : geometry;

  return largestPolygon(multi, 0);
}

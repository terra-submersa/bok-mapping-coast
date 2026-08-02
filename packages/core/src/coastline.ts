import { buffer as turfBuffer } from "@turf/turf";
import { contours } from "d3-contour";
import type { ContourOptions, RatioGrid } from "./contour.js";
import { gridToLonLat } from "./contour.js";
import { contourRings } from "./rings.js";

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
 * A single simple polygon covering the coast out to `metres` offshore (the
 * land itself included) — a guaranteed-continuous strip along the whole
 * coastline, so a hole in the depth contour (Posidonia misread as deep,
 * glint, a cloudy patch) doesn't break the flight boundary right next to
 * shore, where structure-from-motion needs it most (issue #27).
 *
 * Holes are dropped, same reasoning as `bufferPolygon`: the hole is over
 * land, and flying over land is harmless.
 */
export function coastalRibbon(land: GeoJSON.MultiPolygon, metres: number): GeoJSON.Polygon | null {
  if (metres <= 0 || land.coordinates.length === 0) return null;

  const buffered = turfBuffer(land, metres, { units: "meters" });
  if (!buffered) return null;

  const { geometry } = buffered;
  const multi: GeoJSON.MultiPolygon =
    geometry.type === "Polygon"
      ? { type: "MultiPolygon", coordinates: [geometry.coordinates] }
      : geometry;

  const largest = contourRings(multi, 0)[0];
  return largest ? largest.polygon : null;
}

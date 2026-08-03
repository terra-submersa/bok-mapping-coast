import { bboxClip } from "@turf/turf";
import type { BBox } from "./bbox.js";
import { largestPolygon } from "./rings.js";

/**
 * Clips a polygon to the AOI bbox.
 *
 * The buffer and coastal-ribbon steps grow geometry outward in unbounded
 * geographic space, so wherever the raw contour or land mask touches the
 * AOI's edge, the grown result juts past it (issue #29). The composite
 * raster is pinned exactly to the AOI, so this restores that same edge as
 * the boundary's hard limit.
 *
 * Holes are kept: the coastal ribbon relies on one to exclude inland land
 * (issue #30), and clipping a polygon that has one is exactly where that
 * hole either gets clipped open into the AOI edge or stays a hole — either
 * way it must survive this step.
 */
export function clipToBbox(polygon: GeoJSON.Polygon, bbox: BBox): GeoJSON.Polygon {
  if (polygon.coordinates.length === 0) return polygon;

  const { geometry } = bboxClip(polygon, bbox);

  if (geometry.type === "Polygon") return geometry;
  if (geometry.type === "MultiPolygon") {
    return largestPolygon(geometry, 0) ?? { type: "Polygon", coordinates: [] };
  }
  return { type: "Polygon", coordinates: [] };
}

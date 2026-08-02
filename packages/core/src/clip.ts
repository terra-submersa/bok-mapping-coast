import { bboxClip } from "@turf/turf";
import type { BBox } from "./bbox.js";
import { contourRings } from "./rings.js";

/**
 * Clips a polygon to the AOI bbox.
 *
 * The buffer and coastal-ribbon steps grow geometry outward in unbounded
 * geographic space, so wherever the raw contour or land mask touches the
 * AOI's edge, the grown result juts past it (issue #29). The composite
 * raster is pinned exactly to the AOI, so this restores that same edge as
 * the boundary's hard limit.
 */
export function clipToBbox(polygon: GeoJSON.Polygon, bbox: BBox): GeoJSON.Polygon {
  if (polygon.coordinates.length === 0) return polygon;

  const { geometry } = bboxClip(polygon, bbox);

  if (geometry.type === "Polygon") return geometry;
  if (geometry.type === "MultiPolygon") {
    const largest = contourRings({ type: "MultiPolygon", coordinates: geometry.coordinates })[0];
    return largest ? largest.polygon : { type: "Polygon", coordinates: [] };
  }
  return { type: "Polygon", coordinates: [] };
}

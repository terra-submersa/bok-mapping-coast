import { buffer as turfBuffer } from "@turf/turf";
import { contourRings } from "./rings.js";

/** Deep copy — coordinates are plain numbers, so this needs nothing clever. */
function clonePolygon(polygon: GeoJSON.Polygon): GeoJSON.Polygon {
  return {
    type: "Polygon",
    coordinates: polygon.coordinates.map((ring) => ring.map((position) => [...position])),
  };
}

/**
 * Grows a ring outward by `metres`, so flight lines reach past the raw
 * shallow-water contour and catch shoreline features — structure-from-motion
 * has no tie points over open water, so the contour is an input to the flight
 * area, not the flight area itself (story 4.3).
 *
 * Always returns a new geometry: the caller keeps the pre-buffer ring so the
 * distance can be re-dragged, including back to zero, without recomputing
 * anything upstream.
 */
export function bufferPolygon(polygon: GeoJSON.Polygon, metres: number): GeoJSON.Polygon {
  if (metres <= 0 || polygon.coordinates.length === 0) {
    return clonePolygon(polygon);
  }

  const buffered = turfBuffer(polygon, metres, { units: "meters" });
  if (!buffered) return { type: "Polygon", coordinates: [] };

  const { geometry } = buffered;
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: [geometry.coordinates[0]] };
  }

  // An outward buffer of a single simple ring should not split into multiple
  // polygons, but if it ever does, the largest one is the honest default.
  const largest = contourRings({ type: "MultiPolygon", coordinates: geometry.coordinates })[0];
  return largest ? largest.polygon : { type: "Polygon", coordinates: [] };
}

import { area, polygon as turfPolygon } from "@turf/turf";

/**
 * Picks the single largest exterior ring from a contour.
 *
 * Pilot 2 wants one simple polygon, but a raster contour is a MultiPolygon of
 * dozens of rings — one real survey area plus offshore noise. Until story 4.1
 * lets the Planner choose, taking the largest by area is the honest default.
 *
 * Holes are dropped: a mapping boundary with an island cut out is not something
 * Pilot 2 handles, and flying over the hole is harmless.
 */
export function largestRing(geometry: GeoJSON.MultiPolygon): GeoJSON.Polygon | null {
  let best: GeoJSON.Position[] | null = null;
  let bestArea = -1;

  for (const polygon of geometry.coordinates) {
    const ring = polygon[0];
    if (!ring || ring.length < 4) continue;
    const ringArea = area(turfPolygon([ring]));
    if (ringArea > bestArea) {
      bestArea = ringArea;
      best = ring;
    }
  }

  return best ? { type: "Polygon", coordinates: [best] } : null;
}

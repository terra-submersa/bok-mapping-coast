import { featureCollection, polygon as turfPolygon, union as turfUnion } from "@turf/turf";
import { largestPolygon } from "./rings.js";

/**
 * Merges two flight-boundary candidates into the one simple polygon Pilot 2
 * gets — e.g. the buffered/selected depth-contour ring and the coastal ribbon
 * that guarantees continuous near-shore coverage regardless of contour gaps
 * (issue #27). If the union splits into disjoint pieces, the largest by area
 * wins — same reasoning as `bufferPolygon`. Its holes are kept, not dropped:
 * the coastal ribbon relies on a hole to keep excluded inland land excluded
 * (issue #30) — only the boundary's very last step drops holes.
 */
export function unionPolygons(a: GeoJSON.Polygon, b: GeoJSON.Polygon): GeoJSON.Polygon {
  if (a.coordinates.length === 0) return b;
  if (b.coordinates.length === 0) return a;

  const merged = turfUnion(
    featureCollection([turfPolygon(a.coordinates), turfPolygon(b.coordinates)]),
  );
  if (!merged) return a;

  const { geometry } = merged;
  const multi: GeoJSON.MultiPolygon =
    geometry.type === "Polygon"
      ? { type: "MultiPolygon", coordinates: [geometry.coordinates] }
      : geometry;

  return largestPolygon(multi, 0) ?? a;
}

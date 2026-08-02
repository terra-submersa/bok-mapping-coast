import { featureCollection, polygon as turfPolygon, union as turfUnion } from "@turf/turf";
import { contourRings } from "./rings.js";

/**
 * Merges two flight-boundary candidates into the one simple polygon Pilot 2
 * gets — e.g. the buffered/selected depth-contour ring and the coastal ribbon
 * that guarantees continuous near-shore coverage regardless of contour gaps
 * (issue #27). Holes are dropped and, if the union splits into disjoint
 * pieces, the largest by area wins — same reasoning as `bufferPolygon`.
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

  const largest = contourRings(multi, 0)[0];
  return largest ? largest.polygon : a;
}

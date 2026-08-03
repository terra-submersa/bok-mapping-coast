import { simplify } from "@turf/turf";
import { cloneMultiPolygon } from "./polygonal.js";

/**
 * Vertex ceiling above which Pilot 2 is expected to struggle.
 *
 * This is an estimate, not a measured limit — story 6.1 is not done until a file
 * has round-tripped on the actual RC, and this number should be corrected from
 * whatever that shows.
 */
export const PILOT2_VERTEX_CEILING = 500;

/** Degrees of latitude per metre. Longitude shrinks with latitude, but for a
 * simplification tolerance the difference is not worth a projection. */
const DEGREES_PER_METRE = 1 / 111_320;

/**
 * Douglas-Peucker simplification with the tolerance given in metres.
 *
 * Always returns a new geometry: the caller keeps the original contour so
 * simplification stays non-destructive and the tolerance can be re-dragged
 * without recomputing the composite.
 */
export function simplifyContour(
  geometry: GeoJSON.MultiPolygon,
  toleranceMetres: number,
): GeoJSON.MultiPolygon;
export function simplifyContour(
  geometry: GeoJSON.Polygon,
  toleranceMetres: number,
): GeoJSON.Polygon;
export function simplifyContour(
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon,
  toleranceMetres: number,
): GeoJSON.MultiPolygon | GeoJSON.Polygon {
  if (geometry.type === "Polygon") {
    const asMulti = simplifyContour(
      { type: "MultiPolygon", coordinates: [geometry.coordinates] },
      toleranceMetres,
    );
    return { type: "Polygon", coordinates: asMulti.coordinates[0] ?? [] };
  }

  if (toleranceMetres <= 0 || geometry.coordinates.length === 0) {
    return cloneMultiPolygon(geometry);
  }

  const simplified = simplify(cloneMultiPolygon(geometry), {
    tolerance: toleranceMetres * DEGREES_PER_METRE,
    highQuality: true,
    mutate: true,
  }) as GeoJSON.MultiPolygon;

  // Simplification can collapse a small ring into fewer than the four positions a
  // closed ring needs; those rings are dropped rather than emitted as invalid.
  return {
    type: "MultiPolygon",
    coordinates: simplified.coordinates
      .map((polygon) => polygon.filter((ring) => ring.length >= 4))
      .filter((polygon) => polygon.length > 0),
  };
}

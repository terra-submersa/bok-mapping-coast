import { feature, featureCollection, union as turfUnion } from "@turf/turf";
import { largestPolygon } from "./rings.js";

type Polygonal = GeoJSON.Polygon | GeoJSON.MultiPolygon;

function toMultiPolygon(geometry: Polygonal): GeoJSON.MultiPolygon {
  return geometry.type === "Polygon"
    ? { type: "MultiPolygon", coordinates: [geometry.coordinates] }
    : geometry;
}

const EMPTY_POLYGON: GeoJSON.Polygon = { type: "Polygon", coordinates: [] };

/**
 * Merges two flight-boundary candidates into the one simple polygon Pilot 2
 * gets — e.g. the buffered/selected depth-contour ring and the coastal
 * ribbon that guarantees continuous near-shore coverage regardless of
 * contour gaps (issue #27). The ribbon can itself be several disjoint
 * pieces, one per landmass (issue #31), so either input may be a `Polygon`
 * or a `MultiPolygon`.
 *
 * If the union splits into disjoint pieces, the largest by area wins — same
 * reasoning as `bufferPolygon` — and this is the only place that happens:
 * holes are otherwise kept, not dropped, since they can be meaningful in
 * their own right (a genuinely deep patch inside an otherwise shallow depth
 * contour, say) — only the boundary's very last step drops them.
 */
export function unionPolygons(a: Polygonal, b: Polygonal): GeoJSON.Polygon {
  if (a.coordinates.length === 0) return largestPolygon(toMultiPolygon(b), 0) ?? EMPTY_POLYGON;
  if (b.coordinates.length === 0) return largestPolygon(toMultiPolygon(a), 0) ?? EMPTY_POLYGON;

  const merged = turfUnion(featureCollection([feature(a), feature(b)]));
  if (!merged) return largestPolygon(toMultiPolygon(a), 0) ?? EMPTY_POLYGON;

  return largestPolygon(toMultiPolygon(merged.geometry), 0) ?? EMPTY_POLYGON;
}

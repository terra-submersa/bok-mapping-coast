import { feature, featureCollection, union as turfUnion } from "@turf/turf";
import { type Polygonal, toMultiPolygon } from "./polygonal.js";

/**
 * Merges two flight-boundary candidates — e.g. the buffered/selected
 * depth-contour ring and the coastal ribbon that guarantees continuous
 * near-shore coverage regardless of contour gaps (issue #27). Either input
 * may be a `Polygon` or a `MultiPolygon`: the ribbon is one piece per
 * landmass (issue #31), and "All rings" unions several contour rings.
 *
 * Every disjoint piece survives, and so does every hole (issue #33). This
 * used to end in `largestPolygon`, on the reasoning that Pilot 2 wants one
 * simple polygon — but a bay with an island and two separate stretches of
 * coast is genuinely several survey areas, and discarding all but the biggest
 * four steps before the export made the boundary quietly wrong rather than
 * simple. The one-polygon-per-Placemark concern belongs at the export, where
 * `boundaryKml` now writes one Placemark per piece.
 */
export function unionPolygons(a: Polygonal, b: Polygonal): GeoJSON.MultiPolygon {
  if (a.coordinates.length === 0) return toMultiPolygon(b);
  if (b.coordinates.length === 0) return toMultiPolygon(a);

  const merged = turfUnion(featureCollection<Polygonal>([feature(a), feature(b)]));
  if (!merged) return toMultiPolygon(a);

  return toMultiPolygon(merged.geometry);
}

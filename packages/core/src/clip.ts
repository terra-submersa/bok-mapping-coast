import { feature, featureCollection, intersect as turfIntersect } from "@turf/turf";
import { EMPTY_MULTI_POLYGON, type Polygonal, toMultiPolygon } from "./polygonal.js";

/**
 * Clips a boundary to the AOI.
 *
 * The buffer step grows geometry outward in unbounded geographic space, so
 * wherever the raw contour touches the AOI's edge, the grown result juts past
 * it (issue #29). This restores that same edge as the boundary's hard limit.
 *
 * The AOI is a polygon now, not a rectangle (D10), so this is a general
 * intersection rather than turf's `bboxClip`. A rectangle still works — it is
 * just a polygon — which is how the tests written against the old bbox
 * behaviour carry over unchanged.
 *
 * `aoi` is `Polygonal` rather than `Aoi` on purpose: what actually gets
 * clipped against is the AOI intersected with the composite's rectangle, and a
 * concave AOI straddling the raster edge can leave that in several pieces.
 *
 * Every clipped fragment is kept, not just the largest: a single ring cut by
 * the AOI edge can legitimately fall into several pieces (issue #33). Holes
 * are kept too — a hole can be meaningful in its own right, a genuinely deep
 * patch inside an otherwise shallow depth contour, say (issue #30) — and
 * clipping a polygon that has one is exactly where that hole either gets
 * opened into the AOI edge or stays a hole; either way it must survive.
 */
export function clipToAoi(geometry: Polygonal, aoi: Polygonal): GeoJSON.MultiPolygon {
  const multi = toMultiPolygon(geometry);
  if (multi.coordinates.length === 0) return multi;

  const clipped = turfIntersect(featureCollection<Polygonal>([feature(multi), feature(aoi)]));
  if (!clipped) return EMPTY_MULTI_POLYGON;

  // A clip can shave a ring down to fewer than the four positions a closed
  // ring needs; those are dropped rather than emitted as invalid geometry.
  return {
    type: "MultiPolygon",
    coordinates: toMultiPolygon(clipped.geometry)
      .coordinates.map((polygon) => polygon.filter((ring) => ring.length >= 4))
      .filter((polygon) => polygon.length > 0),
  };
}

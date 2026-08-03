import { bboxClip } from "@turf/turf";
import type { BBox } from "./bbox.js";
import { EMPTY_MULTI_POLYGON, type Polygonal, toMultiPolygon } from "./polygonal.js";

/**
 * Clips a boundary to the AOI bbox.
 *
 * The buffer step grows geometry outward in unbounded geographic space, so
 * wherever the raw contour touches the AOI's edge, the grown result juts past
 * it (issue #29). The composite raster is pinned exactly to the AOI, so this
 * restores that same edge as the boundary's hard limit. (The coastal ribbon
 * no longer needs this — it is bounded by the AOI at source since issue #32.)
 *
 * Every clipped fragment is kept, not just the largest: a single ring cut by
 * the AOI edge can legitimately fall into several pieces (issue #33). Holes
 * are kept too — a hole can be meaningful in its own right, a genuinely deep
 * patch inside an otherwise shallow depth contour, say (issue #30) — and
 * clipping a polygon that has one is exactly where that hole either gets
 * opened into the AOI edge or stays a hole; either way it must survive.
 */
export function clipToBbox(geometry: Polygonal, bbox: BBox): GeoJSON.MultiPolygon {
  const multi = toMultiPolygon(geometry);
  if (multi.coordinates.length === 0) return multi;

  const { geometry: clipped } = bboxClip(multi, bbox);

  if (clipped.type === "Polygon" || clipped.type === "MultiPolygon") {
    // A clip can shave a ring down to fewer than the four positions a closed
    // ring needs; those are dropped rather than emitted as invalid geometry.
    return {
      type: "MultiPolygon",
      coordinates: toMultiPolygon(clipped)
        .coordinates.map((polygon) => polygon.filter((ring) => ring.length >= 4))
        .filter((polygon) => polygon.length > 0),
    };
  }
  return EMPTY_MULTI_POLYGON;
}

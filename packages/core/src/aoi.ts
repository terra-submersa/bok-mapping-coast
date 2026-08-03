import { area, bbox as turfBbox } from "@turf/turf";
import type { BBox } from "./bbox.js";
import type { Polygonal } from "./polygonal.js";

/**
 * The area of interest: a hand-drawn polygon, not a box (D10).
 *
 * A single outer ring, deliberately narrower than `Polygonal`. The Planner
 * reshapes this vertex by vertex, and "which ring am I editing" has no good
 * answer for a `MultiPolygon`. Kiladha Bay is one polygon.
 *
 * Note that the *clip* functions still accept `Polygonal`, because the AOI
 * intersected with the composite's rectangle can legitimately fall into
 * several pieces.
 */
export type Aoi = GeoJSON.Polygon;

/**
 * The rectangle that must be *requested* to cover an AOI.
 *
 * `BBox` has not gone away, it has been demoted: Sentinel Hub takes a box, and
 * `RatioGrid`'s pixel-to-lon/lat mapping interpolates over box corners, so the
 * raster is necessarily rectangular even when the survey area is not. Keeping
 * the two ideas apart is what makes reshaping the AOI inside its existing
 * envelope free — the cached composite is still valid, so it costs a re-clip
 * and not a refetch.
 */
export function aoiEnvelope(aoi: Polygonal): BBox {
  const [minLon, minLat, maxLon, maxLat] = turfBbox(aoi);
  return [minLon, minLat, maxLon, maxLat];
}

/** A box as a closed, counter-clockwise polygon. The rectangle is now a case, not a code path. */
export function rectangleAoi(bbox: BBox): Aoi {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return {
    type: "Polygon",
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}

/**
 * Geodesic area in km². Unlike `bboxAreaKm2` this is the area actually flown,
 * which for anything but a rectangle is smaller — often much smaller — than
 * the envelope that has to be fetched to cover it.
 */
export function polygonAreaKm2(geometry: Polygonal): number {
  return area(geometry) / 1_000_000;
}

/** Whether two AOIs are the same shape, position by position. */
export function sameAoi(a: Aoi | null, b: Aoi | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(a.coordinates) === JSON.stringify(b.coordinates);
}

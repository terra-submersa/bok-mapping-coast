import { area, distance, bbox as turfBbox } from "@turf/turf";
import type { BBox } from "./bbox.js";
import type { Polygonal } from "./polygonal.js";

/** Below three distinct corners there is no polygon left to edit. */
export const MIN_AOI_CORNERS = 3;

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
 * raster is necessarily rectangular even when the survey area is not.
 *
 * What it no longer decides is what gets *fetched*. Since issue #46 the composite
 * is planned from the polygon, as strips — see `planCompositeCoverage` — so this
 * bounds the merged grid rather than the bill. Reshaping the AOI inside an
 * unchanged envelope still re-clips for free and re-uses every strip it still
 * touches; it costs a fetch only where the new shape reaches ground the old one
 * never did.
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

/**
 * The index of the outer ring's vertex nearest `point`, or null if none is within
 * `maxMetres`. The distance is a caller's concern because it is really a *screen*
 * tolerance — a dozen pixels — which only the map knows how to convert.
 *
 * A closed ring repeats its first position as its last. Both are the same corner, so
 * the lower index is returned and `removeVertex` handles the pair together.
 */
export function nearestVertexIndex(
  aoi: Aoi,
  point: GeoJSON.Position,
  maxMetres: number,
): number | null {
  const ring = aoi.coordinates[0];
  if (!ring || ring.length === 0) return null;

  let bestIndex: number | null = null;
  let bestMetres = Number.POSITIVE_INFINITY;

  // `length - 1` skips the closing position: it duplicates index 0.
  const corners = isClosed(ring) ? ring.length - 1 : ring.length;
  for (let index = 0; index < corners; index++) {
    const metres = distance(ring[index], point, { units: "meters" });
    if (metres <= maxMetres && metres < bestMetres) {
      bestMetres = metres;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/**
 * The AOI with one vertex removed, or **null when removing it would leave fewer than
 * three corners** — a shape that is not a polygon is not a smaller AOI, it is a lost
 * one, so the deletion is refused rather than silently producing invalid geometry.
 *
 * Deleting the first corner is the case worth reading twice: it is stored twice, once
 * at index 0 and once as the ring's closing position, so both copies have to go and
 * the ring has to be re-closed on whatever corner is now first.
 */
export function removeVertex(aoi: Aoi, index: number): Aoi | null {
  const [ring, ...holes] = aoi.coordinates;
  if (!ring) return null;

  const closed = isClosed(ring);
  const corners = closed ? ring.length - 1 : ring.length;
  if (index < 0 || index >= corners) return null;
  if (corners <= MIN_AOI_CORNERS) return null;

  const remaining = ring.slice(0, corners).filter((_, i) => i !== index);
  const nextRing = closed ? [...remaining, remaining[0]] : remaining;

  return { type: "Polygon", coordinates: [nextRing, ...holes] };
}

function isClosed(ring: GeoJSON.Position[]): boolean {
  if (ring.length < 2) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

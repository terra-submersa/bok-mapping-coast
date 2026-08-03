import { buffer as turfBuffer } from "@turf/turf";
import {
  cloneMultiPolygon,
  EMPTY_MULTI_POLYGON,
  type Polygonal,
  toMultiPolygon,
} from "./polygonal.js";

/**
 * Grows a boundary outward by `metres`, so flight lines reach past the raw
 * shallow-water contour and catch shoreline features — structure-from-motion
 * has no tie points over open water, so the contour is an input to the flight
 * area, not the flight area itself (story 4.3).
 *
 * Always returns a new geometry: the caller keeps the pre-buffer ring so the
 * distance can be re-dragged, including back to zero, without recomputing
 * anything upstream.
 *
 * Every piece and every hole survives (issue #33). This used to keep the
 * outer ring of the largest piece only, which was harmless while the input
 * was a single selected ring and wrong as soon as "All rings" or a
 * multi-piece ribbon reached it.
 */
export function bufferPolygon(geometry: Polygonal, metres: number): GeoJSON.MultiPolygon {
  const multi = toMultiPolygon(geometry);
  if (metres <= 0 || multi.coordinates.length === 0) {
    return cloneMultiPolygon(multi);
  }

  const buffered = turfBuffer(multi, metres, { units: "meters" });
  if (!buffered) return EMPTY_MULTI_POLYGON;

  return toMultiPolygon(buffered.geometry);
}

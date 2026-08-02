import { area, bboxPolygon } from "@turf/turf";

export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

/** Area of a lon/lat bounding box in km², using a geodesic (not planar) calculation. */
export function bboxAreaKm2(bbox: BBox): number {
  return area(bboxPolygon(bbox)) / 1_000_000;
}

/**
 * Whether two bounding boxes are the same box. Compared exactly, deliberately:
 * a composite is fetched on a pixel grid pinned to its bbox corners, so any
 * change at all — however small — makes everything derived from it stale.
 */
export function sameBbox(a: BBox | null, b: BBox | null): boolean {
  if (a === null || b === null) return a === b;
  return a.every((value, index) => value === b[index]);
}

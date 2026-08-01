import { area, bboxPolygon } from "@turf/turf";

export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

/** Area of a lon/lat bounding box in km², using a geodesic (not planar) calculation. */
export function bboxAreaKm2(bbox: BBox): number {
  return area(bboxPolygon(bbox)) / 1_000_000;
}

import { distance } from "@turf/turf";
import type { BBox } from "./bbox.js";

/**
 * Sentinel Hub's synchronous Processing API caps a single /process request at
 * 2500x2500 output pixels. We check against Sentinel-2's native 10 m bands
 * (B02/B03/B08) because the Stumpf ratio needs native resolution, not a
 * resampled one — see CLAUDE.md "Do not download and process Sentinel-2 tiles
 * in Node".
 */
export const SENTINEL2_NATIVE_RESOLUTION_M = 10;
export const PROCESSING_API_MAX_SIDE_PX = 2500;

export interface ProcessingApiLimitCheck {
  widthPx: number;
  heightPx: number;
  exceeds: boolean;
}

/** Estimates the Sentinel-2 native-resolution pixel size of a bbox and flags it against the Processing API's single-request cap. */
export function checkProcessingApiLimit(bbox: BBox): ProcessingApiLimitCheck {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const widthKm = distance([minLon, minLat], [maxLon, minLat], { units: "kilometers" });
  const heightKm = distance([minLon, minLat], [minLon, maxLat], { units: "kilometers" });
  const widthPx = (widthKm * 1000) / SENTINEL2_NATIVE_RESOLUTION_M;
  const heightPx = (heightKm * 1000) / SENTINEL2_NATIVE_RESOLUTION_M;
  return {
    widthPx,
    heightPx,
    exceeds: widthPx > PROCESSING_API_MAX_SIDE_PX || heightPx > PROCESSING_API_MAX_SIDE_PX,
  };
}

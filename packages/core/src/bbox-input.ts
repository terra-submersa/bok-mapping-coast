import { bbox as turfBbox } from "@turf/turf";
import type { BBox } from "./bbox.js";

/**
 * Parses a pasted AOI: either four numbers (minLon,minLat,maxLon,maxLat,
 * comma or whitespace separated) or GeoJSON copied from a tool like
 * geojson.io (a Feature, FeatureCollection, geometry, or a bare bbox array).
 * Throws with a message meant to be shown to the user directly.
 */
export function parseBboxInput(text: string): BBox {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Paste a bounding box: four numbers, or GeoJSON.");
  }

  const bbox =
    trimmed.startsWith("{") || trimmed.startsWith("[")
      ? parseAsJson(trimmed)
      : parseAsNumberList(trimmed);

  return validateBbox(bbox);
}

function parseAsJson(text: string): BBox {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("That doesn't look like valid JSON.");
  }

  if (
    Array.isArray(json) &&
    json.length >= 4 &&
    json.slice(0, 4).every((v) => typeof v === "number")
  ) {
    return json.slice(0, 4) as BBox;
  }

  if (json && typeof json === "object") {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: boundary parse of arbitrary pasted GeoJSON
      const [minLon, minLat, maxLon, maxLat] = turfBbox(json as any);
      return [minLon, minLat, maxLon, maxLat];
    } catch {
      throw new Error("Couldn't find a usable geometry in that GeoJSON.");
    }
  }

  throw new Error("Unrecognised GeoJSON — expected a Feature, geometry, or bbox array.");
}

function parseAsNumberList(text: string): BBox {
  const parts = text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw new Error("Expected four numbers: minLon,minLat,maxLon,maxLat.");
  }
  return parts as BBox;
}

function validateBbox(bbox: BBox): BBox {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
    throw new Error("Bounding box must be four finite numbers.");
  }
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    throw new Error("Bounding box is outside the valid lon/lat range.");
  }
  if (minLon >= maxLon || minLat >= maxLat) {
    throw new Error("Bounding box is empty or inverted — min must be less than max.");
  }
  return bbox;
}

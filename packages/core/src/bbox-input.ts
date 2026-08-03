import { area } from "@turf/turf";
import { type Aoi, aoiEnvelope, rectangleAoi } from "./aoi.js";
import type { BBox } from "./bbox.js";

export interface ParsedAoi {
  /** The shape to survey and to clip against. */
  polygon: Aoi;
  /** The rectangle that has to be requested to cover it. */
  bbox: BBox;
  /** Set when the input held more than one polygon and the largest was taken. */
  note?: string;
}

/**
 * Parses a pasted AOI: either four numbers (minLon,minLat,maxLon,maxLat, comma
 * or whitespace separated) or GeoJSON copied from a tool like geojson.io (a
 * Feature, FeatureCollection, geometry, or a bare bbox array).
 *
 * Pasted GeoJSON now **keeps its shape**. It used to be run through `turfBbox`
 * and reduced to its envelope, which threw away the one thing a hand-drawn AOI
 * is for — you could trace Kiladha Bay in QGIS, paste it, and get a rectangle
 * back (D10).
 *
 * Throws with a message meant to be shown to the user directly.
 */
export function parseAoiInput(text: string): ParsedAoi {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Paste an area: four numbers, or GeoJSON.");
  }

  const parsed =
    trimmed.startsWith("{") || trimmed.startsWith("[")
      ? parseAsJson(trimmed)
      : // Validated *before* the rectangle is built, not after. `aoiEnvelope`
        // returns min/max, so it quietly normalises `23.2,37.4,23.1,37.5` into a
        // valid box — and a swapped pair of numbers is a typo that points at a
        // different stretch of coast, which is exactly what this guard is for.
        { polygon: rectangleAoi(validateBbox(parseAsNumberList(trimmed))) };

  const bbox = validateBbox(aoiEnvelope(parsed.polygon));
  return { ...parsed, bbox };
}

/**
 * The envelope alone, for the one caller that genuinely wants a rectangle:
 * `apps/api` receives a bbox on the query string and never sees the polygon.
 */
export function parseBboxInput(text: string): BBox {
  return parseAoiInput(text).bbox;
}

function parseAsJson(text: string): { polygon: Aoi; note?: string } {
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
    return { polygon: rectangleAoi(validateBbox(json.slice(0, 4) as BBox)) };
  }

  if (!json || typeof json !== "object") {
    throw new Error("Unrecognised GeoJSON — expected a Feature, geometry, or bbox array.");
  }

  const polygons = collectPolygons(json);
  if (polygons.length === 0) {
    throw new Error("Couldn't find a polygon in that GeoJSON.");
  }
  if (polygons.length === 1) return { polygon: polygons[0] };

  // An AOI is one shape, because it is one thing you reshape by hand. Taking
  // the largest is a guess, so say so rather than silently dropping the rest.
  const largest = polygons.reduce((best, next) => (area(next) > area(best) ? next : best));
  return {
    polygon: largest,
    note: `That GeoJSON held ${polygons.length} polygons — the largest was used.`,
  };
}

/**
 * Every polygon anywhere in the pasted GeoJSON, as flat `Polygon`s. Walks
 * FeatureCollections, Features, GeometryCollections and MultiPolygons, and
 * ignores anything that is not polygonal rather than failing on it — a
 * FeatureCollection exported from QGIS routinely carries stray markers.
 */
function collectPolygons(node: unknown): GeoJSON.Polygon[] {
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;

  switch (record.type) {
    case "FeatureCollection":
      return Array.isArray(record.features) ? record.features.flatMap(collectPolygons) : [];
    case "Feature":
      return collectPolygons(record.geometry);
    case "GeometryCollection":
      return Array.isArray(record.geometries) ? record.geometries.flatMap(collectPolygons) : [];
    case "Polygon":
      return isRingArray(record.coordinates)
        ? [{ type: "Polygon", coordinates: record.coordinates }]
        : [];
    case "MultiPolygon":
      return Array.isArray(record.coordinates)
        ? record.coordinates
            .filter(isRingArray)
            .map((coordinates) => ({ type: "Polygon" as const, coordinates }))
        : [];
    default:
      return [];
  }
}

/** A polygon's coordinates: at least one ring, of at least four positions. */
function isRingArray(value: unknown): value is GeoJSON.Position[][] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (ring) =>
        Array.isArray(ring) &&
        ring.length >= 4 &&
        ring.every(
          (position) =>
            Array.isArray(position) && position.length >= 2 && position.every(Number.isFinite),
        ),
    )
  );
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
    throw new Error("An area must have four finite bounds.");
  }
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    throw new Error("Area is outside the valid lon/lat range.");
  }
  if (minLon >= maxLon || minLat >= maxLat) {
    throw new Error("Area is empty or inverted — it has no extent.");
  }
  return bbox;
}

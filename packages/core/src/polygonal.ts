/**
 * Either polygonal geometry. The boundary pipeline speaks `MultiPolygon`
 * throughout — a survey area is routinely several disjoint pieces (one per
 * coastline, one per shallow patch), and collapsing to the largest anywhere
 * upstream silently throws the others away (issue #33). Inputs may still
 * arrive as a plain `Polygon`, so every step accepts both and returns a
 * `MultiPolygon`.
 */
export type Polygonal = GeoJSON.Polygon | GeoJSON.MultiPolygon;

/**
 * Widens a `Polygon` to a one-piece `MultiPolygon`, passing a `MultiPolygon`
 * straight through. An empty `Polygon` widens to *no* pieces rather than one
 * empty piece, so `coordinates.length === 0` keeps meaning "nothing here" at
 * every step.
 */
export function toMultiPolygon(geometry: Polygonal): GeoJSON.MultiPolygon {
  if (geometry.type === "MultiPolygon") return geometry;
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.length === 0 ? [] : [geometry.coordinates],
  };
}

/** Deep copy. Coordinates are plain numbers, so this needs nothing clever. */
export function cloneMultiPolygon(geometry: GeoJSON.MultiPolygon): GeoJSON.MultiPolygon {
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) =>
      polygon.map((ring) => ring.map((position) => [...position])),
    ),
  };
}

/** An empty result, spelled once. */
export const EMPTY_MULTI_POLYGON: GeoJSON.MultiPolygon = { type: "MultiPolygon", coordinates: [] };

/**
 * Every inner ring, as a polygon in its own right — the parts of the boundary that
 * are enclosed by it but deliberately not part of it.
 *
 * Used to warn about the one thing in the export that is both load-bearing and
 * unverified: an exclusion zone in the middle of the survey area reaches Pilot 2 as
 * an `<innerBoundaryIs>`, and whether Pilot honours it is unknown (issue #39).
 */
export function interiorRings(geometry: Polygonal): GeoJSON.Polygon[] {
  return toMultiPolygon(geometry).coordinates.flatMap((piece) =>
    piece.slice(1).map((ring) => ({ type: "Polygon" as const, coordinates: [ring] })),
  );
}

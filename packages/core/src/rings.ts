import { area, booleanPointInPolygon, pointOnFeature, polygon as turfPolygon } from "@turf/turf";

/**
 * One candidate survey ring, with the stats a Planner needs to tell a real
 * shallow-water patch from offshore contour noise (story 4.1).
 *
 * Holes are dropped: a mapping boundary with an island cut out is not
 * something Pilot 2 handles, and flying over the hole is harmless.
 */
export interface ContourRing {
  polygon: GeoJSON.Polygon;
  areaM2: number;
  vertexCount: number;
  /**
   * A point guaranteed to lie on the ring's surface — not its geometric
   * centroid, which for a concave ring (a long shoreline crescent, typically)
   * can fall outside the ring, or even inside an unrelated one. This is what
   * makes it usable as a stable anchor for re-finding the ring later.
   */
  anchor: GeoJSON.Position;
}

/** Every ring of a contour as an independent candidate, largest area first. */
export function contourRings(geometry: GeoJSON.MultiPolygon): ContourRing[] {
  const rings: ContourRing[] = [];

  for (const polygon of geometry.coordinates) {
    const ring = polygon[0];
    if (!ring || ring.length < 4) continue;
    const feature = turfPolygon([ring]);
    rings.push({
      polygon: { type: "Polygon", coordinates: [ring] },
      areaM2: area(feature),
      vertexCount: ring.length,
      anchor: pointOnFeature(feature).geometry.coordinates,
    });
  }

  return rings.sort((a, b) => b.areaM2 - a.areaM2);
}

/**
 * The ring whose boundary contains `point`, if any.
 *
 * Used to keep the Planner's selection pinned to the same patch of water
 * across a threshold change: the ring layout is rebuilt from scratch on every
 * recompute, so there is no stable ring id to track — a geographic point (a
 * ring's `anchor`) is the only thing that means the same water before and after.
 */
export function findRingContaining(
  rings: ContourRing[],
  point: GeoJSON.Position,
): ContourRing | null {
  for (const ring of rings) {
    if (booleanPointInPolygon(point, ring.polygon)) return ring;
  }
  return null;
}

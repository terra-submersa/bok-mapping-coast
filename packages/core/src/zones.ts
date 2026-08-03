import { feature, featureCollection, difference as turfDifference } from "@turf/turf";
import { unionPolygons } from "./merge.js";
import {
  cloneMultiPolygon,
  EMPTY_MULTI_POLYGON,
  type Polygonal,
  toMultiPolygon,
} from "./polygonal.js";

/**
 * Hand-drawn corrections to the flight boundary.
 *
 * These are **inputs, not edits** (D10): the Planner draws them, the project stores
 * them, and they are re-applied to whatever boundary the current parameters produce.
 * That is what makes recomputing non-destructive — there is nothing hand-made inside
 * the derived chain for a threshold change to wipe out.
 *
 * Where they enter the chain is load-bearing, and the reasons are not obvious:
 *
 * - **After the buffer**, or `bufferPolygon` grows the boundary straight back over
 *   the cut.
 * - **After the coastal ribbon is unioned in**, or the ribbon re-adds the harbour
 *   that was just excluded.
 * - **After `simplifyContour`.** Douglas-Peucker moves vertices by up to `tolerance`,
 *   so simplifying a cut reopens it by up to that distance. An exclusion is a safety
 *   constraint — the moorings, the swimming area — and has to be exact at every
 *   tolerance, so it is applied last. The cost is that zone edges are not simplified
 *   and their vertices cannot be reduced by the tolerance slider; hand-drawn zones
 *   are tens of vertices against a ceiling in the hundreds, so that is the cheaper
 *   side of the trade. Pre-simplifying a zone is the wrong fix: it *shrinks* an
 *   exclusion, which under-cuts it.
 * - **Exclusions after inclusions**, so a cut always beats an addition. Deterministic
 *   and explainable, rather than depending on the order the Planner happened to draw
 *   them in.
 */

/** Adds every zone to the boundary. An empty list is a no-op, not an error. */
export function addZones(boundary: Polygonal, zones: readonly Polygonal[]): GeoJSON.MultiPolygon {
  return zones.reduce<GeoJSON.MultiPolygon>(
    (acc, zone) => unionPolygons(acc, zone),
    cloneMultiPolygon(toMultiPolygon(boundary)),
  );
}

/**
 * Cuts every zone out of the boundary.
 *
 * The zones are unioned first and subtracted once, rather than subtracted one by one:
 * two overlapping exclusions then produce one clean cut instead of a sliver of
 * near-coincident edges from repeated boolean ops.
 *
 * A zone that misses the boundary entirely is a no-op. A zone that swallows it
 * whole leaves nothing, which is a legitimate answer and not an error — the panel
 * that renders zero pieces is where that gets said.
 */
export function subtractZones(
  boundary: Polygonal,
  zones: readonly Polygonal[],
): GeoJSON.MultiPolygon {
  const base = toMultiPolygon(boundary);
  // Cloned rather than returned as-is, matching `bufferPolygon`'s contract: nothing
  // in this chain ever hands back a reference to its input.
  if (base.coordinates.length === 0 || zones.length === 0) return cloneMultiPolygon(base);

  const cut = zones.reduce<GeoJSON.MultiPolygon>(
    (acc, zone) => unionPolygons(acc, zone),
    EMPTY_MULTI_POLYGON,
  );
  if (cut.coordinates.length === 0) return cloneMultiPolygon(base);

  const remaining = turfDifference(featureCollection<Polygonal>([feature(base), feature(cut)]));
  if (!remaining) return EMPTY_MULTI_POLYGON;

  return toMultiPolygon(remaining.geometry);
}

import {
  addZones,
  bufferPolygon,
  type ContourRing,
  clipToAoi,
  coastalRibbon,
  contourRings,
  countVertices,
  findRingContaining,
  landMask,
  rectangleAoi,
  shallowWaterContour,
  simplifyContour,
  subtractZones,
  toMultiPolygon,
  unionPolygons,
} from "@bok/core";
import { useEffect, useMemo } from "react";
import { useProject } from "./ProjectContext.js";

export interface PolygonStats {
  vertexCount: number;
  areaM2: number;
}

/**
 * Vertex and area totals across *every* piece. The buffer panel used to read these
 * off the largest ring alone, which understated a boundary made of several disjoint
 * survey areas (issue #33).
 */
function polygonStats(geometry: GeoJSON.MultiPolygon | null): PolygonStats {
  if (!geometry || geometry.coordinates.length === 0) return { vertexCount: 0, areaM2: 0 };
  return {
    vertexCount: countVertices(geometry),
    areaM2: contourRings(geometry, 0).reduce((total, ring) => total + ring.areaM2, 0),
  };
}

export interface BoundaryState {
  contour: GeoJSON.MultiPolygon | null;
  rings: ContourRing[];
  selectedRing: ContourRing | null;
  combinedPolygon: GeoJSON.MultiPolygon | null;
  combinedStats: PolygonStats;
  bufferedPolygon: GeoJSON.MultiPolygon | null;
  bufferedStats: PolygonStats;
  mergedPolygon: GeoJSON.MultiPolygon | null;
  /** Before the hand-drawn zones — what the tolerance slider's counts are about. */
  simplified: GeoJSON.MultiPolygon | null;
  /** Inclusions after clipping to the AOI, so a panel can say what was trimmed. */
  clippedInclusions: GeoJSON.MultiPolygon[];
  boundary: GeoJSON.MultiPolygon | null;
}

/**
 * The whole chain from raster to exportable boundary, as pure `useMemo`s over
 * `packages/core`. Lifted out of `MapView` unchanged (issue #38) so that the map,
 * the Area sidebar and the Boundary sidebar can all read the same derived geometry
 * without recomputing it or passing it down by prop.
 *
 * Every step is derived, never applied in place, so dragging any parameter back to
 * its old value restores the previous shape exactly (story 4.2's non-destructive
 * requirement, and the same discipline for the buffer).
 */
export function useBoundary(): BoundaryState {
  const {
    aoi,
    exclusions,
    inclusions,
    composite,
    threshold,
    tolerance,
    bufferMetres,
    coastMetres,
    minRingAreaM2,
    selectedAnchor,
    setSelectedAnchor,
    allRingsSelected,
  } = useProject();

  /**
   * Recomputed synchronously as the slider moves. A Kiladha-sized grid contours in a
   * few milliseconds, comfortably inside the story's 200 ms budget; if a much larger
   * AOI ever makes this stutter, this is the thing to move off the main thread.
   */
  const contour = useMemo(() => {
    if (!composite || threshold === null) return null;
    return shallowWaterContour(composite, threshold);
  }, [composite, threshold]);

  /** Every ring of the raw contour, largest first — the Planner's candidates (story 4.1). */
  const rings = useMemo(
    () => (contour ? contourRings(contour, minRingAreaM2) : []),
    [contour, minRingAreaM2],
  );

  /** The ring containing the last picked point, or the largest ring by default. */
  const selectedRing = useMemo(() => {
    if (rings.length === 0) return null;
    if (selectedAnchor) {
      const match = findRingContaining(rings, selectedAnchor);
      if (match) return match;
    }
    return rings[0];
  }, [rings, selectedAnchor]);

  // Keeps the tracked point pinned to whichever ring ends up selected, so the *next*
  // threshold change matches against this ring's current shape rather than an
  // increasingly stale click position.
  useEffect(() => {
    if (selectedRing) setSelectedAnchor(selectedRing.anchor);
  }, [selectedRing, setSelectedAnchor]);

  /**
   * The raw geometry the buffer step grows: either the one selected ring, or every
   * ring unioned together when the Planner picked "All rings" — e.g. a survey area
   * that a Posidonia gap split into a few adjacent fragments.
   */
  const combinedPolygon = useMemo<GeoJSON.MultiPolygon | null>(() => {
    if (!allRingsSelected) return selectedRing ? toMultiPolygon(selectedRing.polygon) : null;
    if (rings.length === 0) return null;
    return rings
      .map((ring) => toMultiPolygon(ring.polygon))
      .reduce((acc, polygon) => unionPolygons(acc, polygon));
  }, [allRingsSelected, selectedRing, rings]);

  const combinedStats = useMemo(() => polygonStats(combinedPolygon), [combinedPolygon]);

  /**
   * Grown outward so flight lines reach past the raw contour and catch shoreline
   * features — SfM has no tie points over open water (story 4.3).
   */
  const bufferedPolygon = useMemo(
    () => (combinedPolygon ? bufferPolygon(combinedPolygon, bufferMetres) : null),
    [combinedPolygon, bufferMetres],
  );

  const bufferedStats = useMemo(() => polygonStats(bufferedPolygon), [bufferedPolygon]);

  /**
   * The composite's land/no-data mask, standing in for a coastline since the repo has
   * no coastline data source (issue #27).
   */
  const land = useMemo(() => (composite ? landMask(composite) : null), [composite]);

  /**
   * The AOI, cut down to the raster that actually exists for it — and **the one shape
   * that bounds both the ribbon and the clip below.**
   *
   * Two separate constraints meet here. `land` is traced from the composite's grid, so
   * the composite's rectangle is where its artificial cuts lie and the ribbon must not
   * be bounded by anything larger (issue #32). And the AOI is what the Planner actually
   * intends to fly, so nothing may end up outside it (D10). Intersecting once and using
   * the result for both steps satisfies both — and, crucially, keeps the ribbon bounded
   * by exactly the shape that later clips it, which is the entire mechanism of the #32
   * fix. Bound by one shape and clip by another and the clip closes the band along its
   * own edge, wrapping each landmass in an annulus whose hole is the land.
   *
   * The intersection also covers the window where the AOI has moved but the composite
   * for it has not arrived yet: until it does, the effective AOI is the overlap, which
   * is what `MapView` used to get by passing `composite.bbox`.
   */
  const effectiveAoi = useMemo(
    () => (aoi && composite ? clipToAoi(aoi, rectangleAoi(composite.bbox)) : null),
    [aoi, composite],
  );

  /**
   * A continuous strip along the whole coastline out to `coastMetres`, guaranteeing
   * near-shore coverage even where the depth contour has a gap.
   */
  const ribbon = useMemo(
    () => (land && effectiveAoi ? coastalRibbon(land, coastMetres, effectiveAoi) : null),
    [land, effectiveAoi, coastMetres],
  );

  /**
   * The depth-contour ring and the coastal ribbon, merged. Every disjoint piece
   * survives to the export as its own Placemark (issue #33).
   */
  const mergedPolygon = useMemo(() => {
    if (!bufferedPolygon) return null;
    return ribbon ? unionPolygons(bufferedPolygon, ribbon) : bufferedPolygon;
  }, [bufferedPolygon, ribbon]);

  /**
   * The buffer step grows geometry outward in unbounded space, so wherever the raw
   * contour touches the AOI's edge, the grown result juts past it (issue #29).
   * Clipping back to the AOI here — after the union, equivalent to clipping each side
   * beforehand — restores that edge as the boundary's hard limit. The ribbon arrives
   * already bounded by this same `effectiveAoi`, so this is a no-op on it, which is
   * what issue #32 needs it to be.
   */
  const clippedPolygon = useMemo(() => {
    if (!mergedPolygon || !effectiveAoi) return mergedPolygon;
    return clipToAoi(mergedPolygon, effectiveAoi);
  }, [mergedPolygon, effectiveAoi]);

  const simplified = useMemo(
    () => (clippedPolygon ? simplifyContour(clippedPolygon, tolerance) : null),
    [clippedPolygon, tolerance],
  );

  /**
   * Hand-drawn additions, clipped to the AOI first.
   *
   * The clip keeps `boundary ⊆ AOI` true whatever the Planner draws, so the AOI
   * stays the one hard limit on where a mission can go (issue #16). A zone drawn
   * wholly outside it contributes nothing, and the panel says so.
   */
  const clippedInclusions = useMemo(
    () => (effectiveAoi ? inclusions.map((zone) => clipToAoi(zone, effectiveAoi)) : []),
    [inclusions, effectiveAoi],
  );

  const shapedPolygon = useMemo(
    () => (simplified ? addZones(simplified, clippedInclusions) : null),
    [simplified, clippedInclusions],
  );

  /**
   * Hand-drawn cuts, applied **after** simplification and after the additions
   * (issue #17).
   *
   * Douglas-Peucker moves vertices by up to `tolerance`, so simplifying a cut would
   * reopen it by up to that distance. An exclusion is a safety constraint — the
   * moorings, the swimming area — and has to hold exactly at every tolerance, so it
   * goes last. The cost is that zone edges are not simplified and the tolerance
   * slider cannot reduce their vertices; `zones.ts` explains why that is the cheaper
   * side of the trade.
   *
   * Cuts come after additions so an exclusion always beats an overlapping inclusion —
   * deterministic, rather than depending on the order they happened to be drawn in.
   */
  const boundary = useMemo(
    () => (shapedPolygon ? subtractZones(shapedPolygon, exclusions) : null),
    [shapedPolygon, exclusions],
  );

  return {
    contour,
    rings,
    selectedRing,
    combinedPolygon,
    combinedStats,
    bufferedPolygon,
    bufferedStats,
    mergedPolygon,
    simplified,
    clippedInclusions,
    boundary,
  };
}

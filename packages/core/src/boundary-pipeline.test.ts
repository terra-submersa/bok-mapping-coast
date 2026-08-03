import { booleanPointInPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { type Aoi, rectangleAoi } from "./aoi.js";
import type { BBox } from "./bbox.js";
import { bufferPolygon } from "./buffer.js";
import { clipToAoi } from "./clip.js";
import { coastalRibbon, landMask } from "./coastline.js";
import { type RatioGrid, shallowWaterContour } from "./contour.js";
import { unionPolygons } from "./merge.js";
import { toMultiPolygon } from "./polygonal.js";
import { contourRings } from "./rings.js";
import { simplifyContour } from "./simplify.js";

/**
 * End-to-end over the whole boundary chain, in the order `MapView` runs it.
 *
 * The individual steps each have their own tests; this exists because the two
 * bugs it guards against were *composition* bugs. Every step preserved every
 * landmass on its own and the boundary still came out with one coastline
 * (#33), and the ribbon was seaward-only at every step and still wrapped the
 * mainland once the AOI clip ran (#32).
 */

const AOI: BBox = [0, 0, 8, 8];

/**
 * Kiladha in miniature. A staircase coastline filling the lower-left corner,
 * so the mainland is cut by two AOI edges; an island wholly inside the AOI;
 * and a band of genuinely shallow water off the mainland for the depth
 * contour to find.
 */
function kiladhaGrid(): RatioGrid {
  const ratio: number[] = [];
  const sceneCount: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const mainland = x + (7 - y) < 4;
      const island = x >= 5 && x <= 6 && y >= 2 && y <= 3;
      const isLand = mainland || island;
      sceneCount.push(isLand ? 0 : 10);
      // Shallow (low ratio) just off the mainland, deep further out.
      ratio.push(x + (7 - y) < 6 ? 0.1 : 0.9);
    }
  }
  return { width: 8, height: 8, ratio, sceneCount, bbox: AOI };
}

/**
 * What actually reaches the KML: `boundaryKml` writes each piece's outer ring
 * and drops its holes, so a boundary is only safe to fly if it is safe read
 * this way. Checking the filled geometry instead is what let the inland-
 * triangle export bug hide behind a correct-looking map.
 */
function asExported(boundary: GeoJSON.MultiPolygon): GeoJSON.MultiPolygon {
  return {
    type: "MultiPolygon",
    coordinates: boundary.coordinates.map((piece) => [piece[0]]),
  };
}

/**
 * The lower-left half of the AOI, cut corner to corner. The mainland and the
 * shallow band off it stay inside; the island at (5–6, 2–3) falls outside.
 * Its envelope is the whole of `AOI`, so anything this excludes is something
 * only a polygon AOI can exclude (D10).
 */
const DIAGONAL_AOI: Aoi = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [8, 0],
      [0, 8],
      [0, 0],
    ],
  ],
};

/**
 * The AOI defaults to the rectangle the grid covers, so every assertion below
 * that predates D10 runs against exactly the geometry it was written for — the
 * rectangle is now a case, not a separate code path.
 *
 * Note that `aoi` is passed to `coastalRibbon` *and* to `clipToAoi`. That is
 * not tidiness: bounding the ribbon by one shape and clipping by another is
 * precisely the #32 bug, and it is only reachable now that the two can differ.
 */
function buildBoundary({
  threshold = 0.5,
  bufferMetres = 20_000,
  coastMetres = 50_000,
  tolerance = 0,
  aoi = rectangleAoi(AOI),
}: {
  threshold?: number;
  bufferMetres?: number;
  coastMetres?: number;
  tolerance?: number;
  aoi?: Aoi;
} = {}): GeoJSON.MultiPolygon {
  const grid = kiladhaGrid();

  const rings = contourRings(shallowWaterContour(grid, threshold), 0);
  const combined = rings.length
    ? rings
        .map((ring) => toMultiPolygon(ring.polygon))
        .reduce((acc, polygon) => unionPolygons(acc, polygon))
    : { type: "MultiPolygon" as const, coordinates: [] };

  const buffered = bufferPolygon(combined, bufferMetres);
  const ribbon = coastalRibbon(landMask(grid), coastMetres, aoi);
  const merged = ribbon ? unionPolygons(buffered, ribbon) : buffered;

  return simplifyContour(clipToAoi(merged, aoi), tolerance);
}

describe("the boundary pipeline", () => {
  it("covers the water off every landmass, not just the largest (issue #33)", () => {
    const boundary = buildBoundary();

    // Water just off the mainland's diagonal coast ...
    expect(booleanPointInPolygon([4.2, 0.6], boundary)).toBe(true);
    // ... and water just off the island, which the largest-piece collapse
    // used to discard somewhere between the ribbon and the export.
    expect(booleanPointInPolygon([4.9, 5], boundary)).toBe(true);
    expect(booleanPointInPolygon([7.1, 5], boundary)).toBe(true);
  });

  it("keeps the pieces disjoint rather than merging them into one", () => {
    expect(buildBoundary().coordinates.length).toBeGreaterThan(1);
  });

  it("never puts land inside what gets exported (issues #32, #33)", () => {
    const exported = asExported(buildBoundary());

    // Deep inside the mainland, ~100 km from the coast either way. Before
    // #32 the ribbon wrapped the landmass and closed along the AOI edges, and
    // because the export drops holes, the KML covered the whole triangle.
    expect(booleanPointInPolygon([1, 1], exported)).toBe(false);
    expect(booleanPointInPolygon([0.5, 1.5], exported)).toBe(false);
  });

  it("never leaves the AOI", () => {
    const [minLon, minLat, maxLon, maxLat] = AOI;
    for (const [lon, lat] of buildBoundary().coordinates.flat(2)) {
      expect(lon).toBeGreaterThanOrEqual(minLon);
      expect(lon).toBeLessThanOrEqual(maxLon);
      expect(lat).toBeGreaterThanOrEqual(minLat);
      expect(lat).toBeLessThanOrEqual(maxLat);
    }
  });

  it("survives simplification without losing a piece", () => {
    const full = buildBoundary();
    const simplified = buildBoundary({ tolerance: 2_000 });
    expect(simplified.coordinates).toHaveLength(full.coordinates.length);
  });

  it("still covers every landmass with no depth contour at all", () => {
    // Threshold below every ratio in the grid, so the contour is empty and the
    // coastal ribbon is the entire boundary — the case issue #27 exists for.
    const boundary = buildBoundary({ threshold: 0 });
    expect(booleanPointInPolygon([4.2, 0.6], boundary)).toBe(true);
    expect(booleanPointInPolygon([4.9, 5], boundary)).toBe(true);
    expect(booleanPointInPolygon([1, 1], asExported(boundary))).toBe(false);
  });

  describe("with a non-rectangular AOI (D10)", () => {
    it("stops at the AOI's own edge, not at its envelope", () => {
      const boundary = buildBoundary({ aoi: DIAGONAL_AOI });

      // Below the diagonal, off the mainland — still surveyed.
      expect(booleanPointInPolygon([4.2, 0.6], boundary)).toBe(true);
      // Above the diagonal. Inside the envelope, so the old rectangle clip kept
      // it; the polygon AOI is the only thing that can cut it.
      expect(booleanPointInPolygon([6, 6], boundary)).toBe(false);
      for (const [lon, lat] of boundary.coordinates.flat(2)) {
        expect(lon + lat).toBeLessThanOrEqual(8 + 1e-9);
      }
    });

    it("does not wrap the mainland once the AOI edge is a diagonal (issue #32)", () => {
      // #32's failure mode, moved onto a slanted edge: the ribbon escapes the
      // shape it was bounded by, the clip snaps it shut along the AOI edge, and
      // the landmass ends up inside an annulus whose hole dies at export.
      const exported = asExported(buildBoundary({ aoi: DIAGONAL_AOI }));

      expect(booleanPointInPolygon([1, 1], exported)).toBe(false);
      expect(booleanPointInPolygon([0.5, 1.5], exported)).toBe(false);
    });

    it("drops a landmass that falls outside the AOI entirely", () => {
      // The island sits above the diagonal, so it is not in the survey at all —
      // and must not drag a ribbon in with it.
      const boundary = buildBoundary({ aoi: DIAGONAL_AOI });
      expect(booleanPointInPolygon([4.9, 5], boundary)).toBe(false);
      expect(booleanPointInPolygon([7.1, 5], boundary)).toBe(false);
    });
  });
});

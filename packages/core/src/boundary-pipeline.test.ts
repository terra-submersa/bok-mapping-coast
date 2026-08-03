import { booleanPointInPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import type { BBox } from "./bbox.js";
import { bufferPolygon } from "./buffer.js";
import { clipToBbox } from "./clip.js";
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

function buildBoundary({
  threshold = 0.5,
  bufferMetres = 20_000,
  coastMetres = 50_000,
  tolerance = 0,
} = {}): GeoJSON.MultiPolygon {
  const grid = kiladhaGrid();

  const rings = contourRings(shallowWaterContour(grid, threshold), 0);
  const combined = rings.length
    ? rings
        .map((ring) => toMultiPolygon(ring.polygon))
        .reduce((acc, polygon) => unionPolygons(acc, polygon))
    : { type: "MultiPolygon" as const, coordinates: [] };

  const buffered = bufferPolygon(combined, bufferMetres);
  const ribbon = coastalRibbon(landMask(grid), coastMetres, grid.bbox);
  const merged = ribbon ? unionPolygons(buffered, ribbon) : buffered;

  return simplifyContour(clipToBbox(merged, grid.bbox), tolerance);
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
});

import { booleanPointInPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { contourRings, findRingContaining } from "./rings.js";

function square(lon: number, lat: number, size: number): GeoJSON.Position[] {
  return [
    [lon, lat],
    [lon + size, lat],
    [lon + size, lat + size],
    [lon, lat + size],
    [lon, lat],
  ];
}

describe("contourRings", () => {
  it("returns nothing for an empty contour", () => {
    expect(contourRings({ type: "MultiPolygon", coordinates: [] })).toEqual([]);
  });

  it("sorts rings largest area first", () => {
    const geometry: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [[square(23.1, 37.4, 0.001)], [square(23.2, 37.4, 0.02)]],
    };
    const rings = contourRings(geometry);
    expect(rings).toHaveLength(2);
    expect(rings[0].areaM2).toBeGreaterThan(rings[1].areaM2);
    expect(rings[0].polygon.coordinates[0][0][0]).toBeCloseTo(23.2, 5);
  });

  it("drops holes, keeping only the exterior ring", () => {
    const geometry: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [[square(23.1, 37.4, 0.02), square(23.105, 37.405, 0.002)]],
    };
    expect(contourRings(geometry)[0].polygon.coordinates).toHaveLength(1);
  });

  it("ignores rings too short to be closed polygons", () => {
    const geometry: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [23.1, 37.4],
            [23.2, 37.4],
          ],
        ],
      ],
    };
    expect(contourRings(geometry)).toEqual([]);
  });

  it("reports vertex count and an anchor inside the ring", () => {
    const geometry: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [[square(23.1, 37.4, 0.02)]],
    };
    const [ring] = contourRings(geometry);
    expect(ring.vertexCount).toBe(5);
    expect(booleanPointInPolygon(ring.anchor, ring.polygon)).toBe(true);
  });

  it("anchors a concave ring inside itself, unlike a geometric centroid", () => {
    // A crescent, like a shoreline contour: the arithmetic mean of its vertices
    // falls in the bite taken out of it — outside the ring entirely. A ring
    // selection anchor must not do that, or clicking this ring would silently
    // re-select whatever ring actually contains that stray point (issue found
    // testing story 4.1's map click-to-select).
    const crescent: GeoJSON.Position[] = [
      [23.1, 37.4],
      [23.14, 37.4],
      [23.14, 37.44],
      [23.1, 37.44],
      [23.1, 37.428],
      [23.128, 37.428],
      [23.128, 37.412],
      [23.1, 37.412],
      [23.1, 37.4],
    ];
    const [ring] = contourRings({ type: "MultiPolygon", coordinates: [[crescent]] });
    expect(booleanPointInPolygon(ring.anchor, ring.polygon)).toBe(true);
  });
});

describe("findRingContaining", () => {
  const geometry: GeoJSON.MultiPolygon = {
    type: "MultiPolygon",
    coordinates: [[square(23.1, 37.4, 0.02)], [square(23.2, 37.4, 0.02)]],
  };
  const rings = contourRings(geometry);

  it("finds the ring a point falls inside", () => {
    const match = findRingContaining(rings, [23.11, 37.41]);
    expect(match?.polygon.coordinates[0][0][0]).toBeCloseTo(23.1, 5);
  });

  it("returns null when the point is outside every ring", () => {
    expect(findRingContaining(rings, [24, 38])).toBeNull();
  });
});

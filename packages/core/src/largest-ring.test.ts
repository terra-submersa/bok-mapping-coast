import { describe, expect, it } from "vitest";
import { largestRing } from "./largest-ring.js";

function square(lon: number, lat: number, size: number): GeoJSON.Position[] {
  return [
    [lon, lat],
    [lon + size, lat],
    [lon + size, lat + size],
    [lon, lat + size],
    [lon, lat],
  ];
}

describe("largestRing", () => {
  it("returns null for an empty contour", () => {
    expect(largestRing({ type: "MultiPolygon", coordinates: [] })).toBeNull();
  });

  it("picks the biggest ring, not the first", () => {
    const geometry: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [[square(23.1, 37.4, 0.001)], [square(23.2, 37.4, 0.02)]],
    };
    const result = largestRing(geometry);
    expect(result?.coordinates[0][0][0]).toBeCloseTo(23.2, 5);
  });

  it("drops holes, keeping only the exterior ring", () => {
    const geometry: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [[square(23.1, 37.4, 0.02), square(23.105, 37.405, 0.002)]],
    };
    expect(largestRing(geometry)?.coordinates).toHaveLength(1);
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
    expect(largestRing(geometry)).toBeNull();
  });
});

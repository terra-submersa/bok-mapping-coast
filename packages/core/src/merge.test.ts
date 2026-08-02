import { area, booleanPointInPolygon, polygon as turfPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { unionPolygons } from "./merge.js";

function square(lon: number, lat: number, size: number): GeoJSON.Polygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [lon, lat],
        [lon + size, lat],
        [lon + size, lat + size],
        [lon, lat + size],
        [lon, lat],
      ],
    ],
  };
}

describe("unionPolygons", () => {
  it("covers both inputs when they overlap", () => {
    const a = square(0, 0, 2);
    const b = square(1, 1, 2);
    const merged = unionPolygons(a, b);
    expect(booleanPointInPolygon([0.5, 0.5], merged)).toBe(true);
    expect(booleanPointInPolygon([2.5, 2.5], merged)).toBe(true);
  });

  it("is at least as large as the larger input", () => {
    const a = square(0, 0, 2);
    const b = square(1, 1, 2);
    const merged = unionPolygons(a, b);
    expect(area(turfPolygon(merged.coordinates))).toBeGreaterThan(area(turfPolygon(a.coordinates)));
  });

  it("falls back to the other polygon when one is empty", () => {
    const a = square(0, 0, 2);
    const empty: GeoJSON.Polygon = { type: "Polygon", coordinates: [] };
    expect(unionPolygons(a, empty)).toEqual(a);
    expect(unionPolygons(empty, a)).toEqual(a);
  });

  it("picks the larger piece when the union is disjoint", () => {
    const small = square(0, 0, 1);
    const big = square(10, 10, 5);
    const merged = unionPolygons(small, big);
    expect(booleanPointInPolygon([12, 12], merged)).toBe(true);
    expect(booleanPointInPolygon([0.5, 0.5], merged)).toBe(false);
  });
});

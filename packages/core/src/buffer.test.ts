import { area, booleanPointInPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { bufferPolygon } from "./buffer.js";
import { toMultiPolygon } from "./polygonal.js";

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

describe("bufferPolygon", () => {
  it("grows the ring outward", () => {
    const original = square(23.1, 37.4, 0.01);
    const buffered = bufferPolygon(original, 30);
    // A point just outside the original ring should be inside the buffered one.
    expect(booleanPointInPolygon([23.1 - 0.0001, 37.405], original)).toBe(false);
    expect(booleanPointInPolygon([23.1 - 0.0001, 37.405], buffered)).toBe(true);
  });

  it("grows more as the distance grows", () => {
    const original = square(23.1, 37.4, 0.01);
    expect(area(bufferPolygon(original, 60))).toBeGreaterThan(area(bufferPolygon(original, 20)));
  });

  it("returns a copy, not the same object, at zero metres", () => {
    const original = square(23.1, 37.4, 0.01);
    const result = bufferPolygon(original, 0);
    expect(result).toEqual(toMultiPolygon(original));
    expect(result.coordinates[0]).not.toBe(original.coordinates);
  });

  it("leaves the original untouched", () => {
    const original = square(23.1, 37.4, 0.01);
    const before = JSON.parse(JSON.stringify(original));
    bufferPolygon(original, 40);
    expect(original).toEqual(before);
  });

  it("handles an empty polygon", () => {
    expect(bufferPolygon({ type: "Polygon", coordinates: [] }, 30).coordinates).toEqual([]);
  });

  it("keeps every piece of a multi-piece boundary (issue #33)", () => {
    // Two survey areas far enough apart that a 30 m buffer cannot merge them.
    const multi: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [square(23.1, 37.4, 0.01).coordinates, square(23.5, 37.8, 0.01).coordinates],
    };
    const buffered = bufferPolygon(multi, 30);
    expect(buffered.coordinates).toHaveLength(2);
    // Just outside each original ring, inside each buffered one.
    expect(booleanPointInPolygon([23.1 - 0.0001, 37.405], buffered)).toBe(true);
    expect(booleanPointInPolygon([23.5 - 0.0001, 37.805], buffered)).toBe(true);
  });
});

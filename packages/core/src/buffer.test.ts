import { area, booleanPointInPolygon, polygon as turfPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { bufferPolygon } from "./buffer.js";

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
    const near = area(turfPolygon(bufferPolygon(original, 20).coordinates));
    const far = area(turfPolygon(bufferPolygon(original, 60).coordinates));
    expect(far).toBeGreaterThan(near);
  });

  it("returns a copy, not the same object, at zero metres", () => {
    const original = square(23.1, 37.4, 0.01);
    const result = bufferPolygon(original, 0);
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
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
});

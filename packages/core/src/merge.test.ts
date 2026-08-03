import { area, booleanPointInPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { unionPolygons } from "./merge.js";
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
    expect(area(unionPolygons(a, b))).toBeGreaterThan(area(a));
  });

  it("falls back to the other polygon when one is empty", () => {
    const a = square(0, 0, 2);
    const empty: GeoJSON.Polygon = { type: "Polygon", coordinates: [] };
    expect(unionPolygons(a, empty)).toEqual(toMultiPolygon(a));
    expect(unionPolygons(empty, a)).toEqual(toMultiPolygon(a));
  });

  it("keeps both pieces when the union is disjoint (issue #33)", () => {
    // Two separate survey areas — an islet's ribbon and the mainland's, say.
    // This used to end in `largestPolygon`, which kept the big one and dropped
    // the small one without a word.
    const small = square(0, 0, 1);
    const big = square(10, 10, 5);
    const merged = unionPolygons(small, big);
    expect(merged.coordinates).toHaveLength(2);
    expect(booleanPointInPolygon([12, 12], merged)).toBe(true);
    expect(booleanPointInPolygon([0.5, 0.5], merged)).toBe(true);
  });

  it("keeps a hole from being silently refilled (issue #30)", () => {
    const donut: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 10],
          [10, 10],
          [10, 0],
          [0, 0],
        ],
        [
          [3, 3],
          [3, 7],
          [7, 7],
          [7, 3],
          [3, 3],
        ],
      ],
    };
    // Disjoint from the donut, so it can't plug the hole either.
    const farAway = square(20, 20, 1);

    const merged = unionPolygons(donut, farAway);
    expect(booleanPointInPolygon([5, 5], merged)).toBe(false);
    expect(booleanPointInPolygon([1, 1], merged)).toBe(true);
    expect(booleanPointInPolygon([20.5, 20.5], merged)).toBe(true);
  });

  it("accepts a MultiPolygon input (issue #31, e.g. a multi-piece coastal ribbon)", () => {
    const a = square(0, 0, 2);
    const overlapping: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [square(1, 1, 2).coordinates],
    };
    const merged = unionPolygons(a, overlapping);
    expect(booleanPointInPolygon([0.5, 0.5], merged)).toBe(true);
    expect(booleanPointInPolygon([2.5, 2.5], merged)).toBe(true);
  });

  it("keeps a MultiPolygon input's disjoint piece (issue #33)", () => {
    const a = square(0, 0, 1);
    const multi: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [square(0.4, 0.4, 5).coordinates, square(20, 20, 1).coordinates],
    };
    const merged = unionPolygons(a, multi);
    // The overlapping piece merges with `a` ...
    expect(booleanPointInPolygon([3, 3], merged)).toBe(true);
    // ... and the far-away piece survives alongside it rather than being
    // dropped by a final largest-piece step.
    expect(booleanPointInPolygon([20.5, 20.5], merged)).toBe(true);
    expect(merged.coordinates).toHaveLength(2);
  });

  it("always returns a MultiPolygon, whatever went in", () => {
    const a = square(0, 0, 2);
    expect(unionPolygons(a, square(1, 1, 2)).type).toBe("MultiPolygon");
    const empty: GeoJSON.Polygon = { type: "Polygon", coordinates: [] };
    expect(unionPolygons(empty, empty)).toEqual({ type: "MultiPolygon", coordinates: [] });
  });
});

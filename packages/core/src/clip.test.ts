import { booleanPointInPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import type { BBox } from "./bbox.js";
import { clipToBbox } from "./clip.js";
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

describe("clipToBbox", () => {
  it("cuts off the part of a polygon that sticks out past the bbox", () => {
    const bbox: BBox = [23.1, 37.4, 23.11, 37.41];
    // Sticks out past the bbox's east and north edges, same as a buffered
    // contour that touches the AOI's edge and grows past it.
    const overflowing = square(23.105, 37.405, 0.02);

    const clipped = clipToBbox(overflowing, bbox);

    expect(booleanPointInPolygon([23.109, 37.409], clipped)).toBe(true);
    expect(booleanPointInPolygon([23.115, 37.409], clipped)).toBe(false);
    expect(booleanPointInPolygon([23.109, 37.415], clipped)).toBe(false);
  });

  it("leaves a polygon already inside the bbox untouched", () => {
    const bbox: BBox = [23.0, 37.0, 24.0, 38.0];
    const inside = square(23.1, 37.4, 0.01);

    expect(clipToBbox(inside, bbox)).toEqual(toMultiPolygon(inside));
  });

  it("handles an empty polygon", () => {
    const bbox: BBox = [23.0, 37.0, 24.0, 38.0];
    expect(clipToBbox({ type: "Polygon", coordinates: [] }, bbox).coordinates).toEqual([]);
  });

  it("keeps a hole intact when clipping (issue #30)", () => {
    const bbox: BBox = [23.0, 37.0, 24.0, 38.0];
    const donut: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        // Outer ring overflows the bbox on every side, same as a buffered ring.
        [
          [22.5, 36.5],
          [22.5, 38.5],
          [24.5, 38.5],
          [24.5, 36.5],
          [22.5, 36.5],
        ],
        // Hole entirely inside the bbox.
        [
          [23.4, 37.4],
          [23.4, 37.6],
          [23.6, 37.6],
          [23.6, 37.4],
          [23.4, 37.4],
        ],
      ],
    };

    const clipped = clipToBbox(donut, bbox);

    expect(booleanPointInPolygon([23.5, 37.5], clipped)).toBe(false);
    expect(booleanPointInPolygon([23.1, 37.1], clipped)).toBe(true);
  });

  it("keeps every piece of a multi-piece boundary (issue #33)", () => {
    const bbox: BBox = [23.0, 37.0, 24.0, 38.0];
    const multi: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        square(23.1, 37.1, 0.05).coordinates,
        // Overflows the east edge, so it is clipped rather than passed through.
        square(23.95, 37.5, 0.2).coordinates,
      ],
    };

    const clipped = clipToBbox(multi, bbox);

    expect(clipped.coordinates).toHaveLength(2);
    expect(booleanPointInPolygon([23.12, 37.12], clipped)).toBe(true);
    expect(booleanPointInPolygon([23.98, 37.55], clipped)).toBe(true);
    // ... and the overflow is still gone.
    expect(booleanPointInPolygon([24.05, 37.55], clipped)).toBe(false);
  });

  it("drops a piece the clip shaves down to nothing", () => {
    const bbox: BBox = [23.0, 37.0, 24.0, 38.0];
    const multi: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [square(23.1, 37.1, 0.05).coordinates, square(30, 30, 1).coordinates],
    };

    const clipped = clipToBbox(multi, bbox);

    expect(clipped.coordinates).toHaveLength(1);
    expect(booleanPointInPolygon([23.12, 37.12], clipped)).toBe(true);
  });
});

import { booleanPointInPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { rectangleAoi } from "./aoi.js";
import type { BBox } from "./bbox.js";
import { clipToAoi } from "./clip.js";
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

describe("clipToAoi", () => {
  it("cuts off the part of a polygon that sticks out past the bbox", () => {
    const bbox: BBox = [23.1, 37.4, 23.11, 37.41];
    // Sticks out past the bbox's east and north edges, same as a buffered
    // contour that touches the AOI's edge and grows past it.
    const overflowing = square(23.105, 37.405, 0.02);

    const clipped = clipToAoi(overflowing, rectangleAoi(bbox));

    expect(booleanPointInPolygon([23.109, 37.409], clipped)).toBe(true);
    expect(booleanPointInPolygon([23.115, 37.409], clipped)).toBe(false);
    expect(booleanPointInPolygon([23.109, 37.415], clipped)).toBe(false);
  });

  it("leaves a polygon already inside the bbox untouched", () => {
    const bbox: BBox = [23.0, 37.0, 24.0, 38.0];
    const inside = square(23.1, 37.4, 0.01);

    expect(clipToAoi(inside, rectangleAoi(bbox))).toEqual(toMultiPolygon(inside));
  });

  it("handles an empty polygon", () => {
    const bbox: BBox = [23.0, 37.0, 24.0, 38.0];
    expect(clipToAoi({ type: "Polygon", coordinates: [] }, rectangleAoi(bbox)).coordinates).toEqual(
      [],
    );
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

    const clipped = clipToAoi(donut, rectangleAoi(bbox));

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

    const clipped = clipToAoi(multi, rectangleAoi(bbox));

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

    const clipped = clipToAoi(multi, rectangleAoi(bbox));

    expect(clipped.coordinates).toHaveLength(1);
    expect(booleanPointInPolygon([23.12, 37.12], clipped)).toBe(true);
  });

  // The AOI stopped being a rectangle in D10. The cases above pass a
  // `rectangleAoi`, so they still pin the old `bboxClip` behaviour exactly;
  // these are what the rectangle was hiding.

  it("clips to a non-rectangular AOI, not to its envelope", () => {
    // Lower-left triangle of the unit square. Its envelope is the whole square,
    // so anything above the diagonal is inside the old bbox and outside this.
    const triangle: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [0, 0],
        ],
      ],
    };

    const clipped = clipToAoi(square(0, 0, 1), triangle);

    expect(booleanPointInPolygon([0.2, 0.2], clipped)).toBe(true);
    // Inside the envelope, above the diagonal — the point the old clip kept.
    expect(booleanPointInPolygon([0.8, 0.8], clipped)).toBe(false);
  });

  it("returns nothing when the AOI misses the geometry entirely", () => {
    expect(clipToAoi(square(0, 0, 1), square(10, 10, 1)).coordinates).toEqual([]);
  });

  it("splits one piece in two when the AOI is concave", () => {
    // A "U": two prongs joined along the bottom, with a notch cut down the
    // middle from the top. A band crossing both prongs comes out as two pieces.
    const u: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [3, 0],
          [3, 3],
          [2, 3],
          [2, 1],
          [1, 1],
          [1, 3],
          [0, 3],
          [0, 0],
        ],
      ],
    };
    const band: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 2],
            [3, 2],
            [3, 2.5],
            [0, 2.5],
            [0, 2],
          ],
        ],
      ],
    };

    const clipped = clipToAoi(band, u);

    expect(clipped.coordinates).toHaveLength(2);
    expect(booleanPointInPolygon([0.5, 2.25], clipped)).toBe(true);
    expect(booleanPointInPolygon([2.5, 2.25], clipped)).toBe(true);
    // The notch between the prongs.
    expect(booleanPointInPolygon([1.5, 2.25], clipped)).toBe(false);
  });
});

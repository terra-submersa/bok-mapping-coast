import { describe, expect, it } from "vitest";
import {
  type Aoi,
  aoiEnvelope,
  nearestVertexIndex,
  polygonAreaKm2,
  rectangleAoi,
  removeVertex,
  sameAoi,
} from "./aoi.js";
import { bboxAreaKm2 } from "./bbox.js";

/** Lower-left half of a box, cut corner to corner. */
function triangle(bbox: [number, number, number, number]): Aoi {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return {
    type: "Polygon",
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}

describe("rectangleAoi", () => {
  it("round-trips through aoiEnvelope", () => {
    const bbox: [number, number, number, number] = [23.1, 37.4, 23.14, 37.44];
    expect(aoiEnvelope(rectangleAoi(bbox))).toEqual(bbox);
  });

  it("produces a closed ring of five positions", () => {
    const ring = rectangleAoi([0, 0, 1, 1]).coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });
});

describe("aoiEnvelope", () => {
  it("is the box that has to be requested, not the shape that gets flown", () => {
    // The distinction the whole of D10 rests on: a diagonal AOI covers half of
    // an envelope the Processing API is nonetheless billed for in full.
    const bbox: [number, number, number, number] = [23.1, 37.4, 23.14, 37.44];
    expect(aoiEnvelope(triangle(bbox))).toEqual(bbox);
  });
});

describe("polygonAreaKm2", () => {
  it("measures the shape, where bboxAreaKm2 measures the envelope", () => {
    const bbox: [number, number, number, number] = [23.1, 37.4, 23.14, 37.44];

    const envelopeKm2 = bboxAreaKm2(bbox);
    const shapeKm2 = polygonAreaKm2(triangle(bbox));

    // Half the envelope, give or take the curvature over 4 km.
    expect(shapeKm2 / envelopeKm2).toBeCloseTo(0.5, 2);
  });

  it("agrees with bboxAreaKm2 for a rectangle", () => {
    const bbox: [number, number, number, number] = [23.1, 37.4, 23.14, 37.44];
    expect(polygonAreaKm2(rectangleAoi(bbox))).toBeCloseTo(bboxAreaKm2(bbox), 6);
  });
});

describe("sameAoi", () => {
  it("tells a reshaped AOI from an unchanged one", () => {
    const a = rectangleAoi([0, 0, 1, 1]);
    expect(sameAoi(a, rectangleAoi([0, 0, 1, 1]))).toBe(true);
    expect(sameAoi(a, triangle([0, 0, 1, 1]))).toBe(false);
  });

  it("treats null as an AOI that is absent, not as one that matches", () => {
    expect(sameAoi(null, null)).toBe(true);
    expect(sameAoi(null, rectangleAoi([0, 0, 1, 1]))).toBe(false);
  });

  it("sees a reshape that leaves the envelope alone", () => {
    // The case the composite cache turns on: same envelope, different shape,
    // so the raster is still valid and only the clip has to be redone.
    const box = rectangleAoi([0, 0, 1, 1]);
    const reshaped = triangle([0, 0, 1, 1]);

    expect(sameAoi(box, reshaped)).toBe(false);
    expect(aoiEnvelope(box)).toEqual(aoiEnvelope(reshaped));
  });
});

/** A ~1 km square off Kiladha, so the metre tolerances below mean something. */
const SQUARE = rectangleAoi([23.1, 37.4, 23.11, 37.41]);

describe("nearestVertexIndex", () => {
  it("finds the corner under the pointer", () => {
    expect(nearestVertexIndex(SQUARE, [23.11001, 37.41001], 20)).toBe(2);
  });

  it("ignores a corner outside the tolerance", () => {
    expect(nearestVertexIndex(SQUARE, [23.105, 37.405], 20)).toBeNull();
  });

  it("never returns the closing position, which is the first corner again", () => {
    // Clicking the shared corner must delete one corner, not confuse the caller
    // into thinking there is a fifth.
    expect(nearestVertexIndex(SQUARE, [23.1, 37.4], 20)).toBe(0);
  });

  it("picks the nearest when two corners are both in range", () => {
    // A tolerance wide enough to cover the whole square: the closest still wins.
    expect(nearestVertexIndex(SQUARE, [23.1099, 37.4001], 5_000)).toBe(1);
  });
});

describe("removeVertex", () => {
  it("removes a middle corner and keeps the ring closed", () => {
    const next = removeVertex(SQUARE, 1) as Aoi;
    const ring = next.coordinates[0];

    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
    expect(ring).not.toContainEqual([23.11, 37.4]);
  });

  it("removes both copies of the first corner and re-closes the ring", () => {
    // The case worth reading twice: corner 0 is stored at index 0 *and* as the
    // closing position, so deleting one copy leaves an unclosed ring.
    const next = removeVertex(SQUARE, 0) as Aoi;
    const ring = next.coordinates[0];

    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
    expect(ring).not.toContainEqual([23.1, 37.4]);
    expect(ring[0]).toEqual([23.11, 37.4]);
  });

  it("refuses the deletion that would leave a two-sided shape", () => {
    const tri = removeVertex(SQUARE, 0) as Aoi;
    expect(removeVertex(tri, 0)).toBeNull();
  });

  it("refuses an index that is not a corner", () => {
    expect(removeVertex(SQUARE, 4)).toBeNull();
    expect(removeVertex(SQUARE, -1)).toBeNull();
  });

  it("does not mutate the AOI it was given", () => {
    const before = JSON.stringify(SQUARE);
    removeVertex(SQUARE, 1);
    expect(JSON.stringify(SQUARE)).toBe(before);
  });

  it("round-trips: deleting the corner nearest a click leaves the others", () => {
    const index = nearestVertexIndex(SQUARE, [23.11001, 37.41001], 20) as number;
    const next = removeVertex(SQUARE, index) as Aoi;

    expect(next.coordinates[0]).not.toContainEqual([23.11, 37.41]);
    expect(next.coordinates[0]).toContainEqual([23.1, 37.4]);
  });
});

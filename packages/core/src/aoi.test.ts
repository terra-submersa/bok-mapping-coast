import { describe, expect, it } from "vitest";
import { type Aoi, aoiEnvelope, polygonAreaKm2, rectangleAoi, sameAoi } from "./aoi.js";
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

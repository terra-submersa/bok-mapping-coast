import { area, booleanPointInPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { interiorRings, toMultiPolygon } from "./polygonal.js";
import { addZones, subtractZones } from "./zones.js";

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

/** A 1-degree survey area, big enough that the zones below are unambiguous. */
const BOUNDARY = square(23, 37, 1);

describe("subtractZones", () => {
  it("cuts an interior zone as a hole, not as a dent", () => {
    const zone = square(23.4, 37.4, 0.2);
    const cut = subtractZones(BOUNDARY, [zone]);

    expect(booleanPointInPolygon([23.5, 37.5], cut)).toBe(false);
    expect(booleanPointInPolygon([23.1, 37.1], cut)).toBe(true);
    expect(interiorRings(cut)).toHaveLength(1);
  });

  it("cuts a zone that straddles the edge as a notch, with no hole", () => {
    const zone = square(23.9, 37.4, 0.4);
    const cut = subtractZones(BOUNDARY, [zone]);

    expect(booleanPointInPolygon([23.95, 37.5], cut)).toBe(false);
    expect(interiorRings(cut)).toHaveLength(0);
  });

  it("removes a piece the zone covers and keeps the others", () => {
    const two: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [BOUNDARY.coordinates, square(25, 37, 0.5).coordinates],
    };
    const cut = subtractZones(two, [square(24.9, 36.9, 0.7)]);

    expect(cut.coordinates).toHaveLength(1);
    expect(booleanPointInPolygon([23.5, 37.5], cut)).toBe(true);
  });

  it("is a no-op for a zone that misses the boundary entirely", () => {
    const cut = subtractZones(BOUNDARY, [square(50, 10, 1)]);
    expect(area(cut)).toBeCloseTo(area(BOUNDARY), 0);
  });

  it("merges overlapping zones into one cut", () => {
    const cut = subtractZones(BOUNDARY, [square(23.3, 37.4, 0.2), square(23.4, 37.4, 0.2)]);
    expect(interiorRings(cut)).toHaveLength(1);
  });

  it("returns an empty boundary when a zone swallows it whole", () => {
    expect(subtractZones(BOUNDARY, [square(22, 36, 3)]).coordinates).toEqual([]);
  });

  it("returns a clone, never the input, when there is nothing to cut", () => {
    const cut = subtractZones(BOUNDARY, []);
    expect(cut).toEqual(toMultiPolygon(BOUNDARY));
    expect(cut.coordinates[0]).not.toBe(BOUNDARY.coordinates[0]);
  });
});

describe("addZones", () => {
  it("unions an adjacent zone into the boundary", () => {
    const added = addZones(BOUNDARY, [square(24, 37, 0.5)]);
    expect(booleanPointInPolygon([24.2, 37.2], added)).toBe(true);
    expect(booleanPointInPolygon([23.5, 37.5], added)).toBe(true);
  });

  it("keeps a detached zone as its own piece", () => {
    const added = addZones(BOUNDARY, [square(30, 37, 0.5)]);
    expect(added.coordinates).toHaveLength(2);
  });

  it("returns a clone for an empty list", () => {
    const added = addZones(BOUNDARY, []);
    expect(added).toEqual(toMultiPolygon(BOUNDARY));
    expect(added.coordinates[0]).not.toBe(BOUNDARY.coordinates[0]);
  });

  it("adds onto an empty boundary", () => {
    const added = addZones({ type: "MultiPolygon", coordinates: [] }, [square(23, 37, 0.2)]);
    expect(booleanPointInPolygon([23.1, 37.1], added)).toBe(true);
  });
});

describe("inclusions and exclusions together", () => {
  it("lets an exclusion beat an overlapping inclusion", () => {
    // Order is fixed by the pipeline, not by the order they were drawn: add, then
    // cut. A zone marked "do not fly" wins over one marked "also cover this".
    const inclusion = square(24, 37, 0.5);
    const exclusion = square(24.1, 37.1, 0.2);

    const result = subtractZones(addZones(BOUNDARY, [inclusion]), [exclusion]);

    expect(booleanPointInPolygon([24.4, 37.4], result)).toBe(true);
    expect(booleanPointInPolygon([24.2, 37.2], result)).toBe(false);
  });
});

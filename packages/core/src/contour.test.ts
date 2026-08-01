import { booleanPointInPolygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { countVertices, type RatioGrid, shallowWaterContour } from "./contour.js";

/**
 * 4x4 grid over a bbox chosen so grid x maps straight onto longitude and
 * latitude counts back down from the top row.
 */
function grid(ratio: number[], sceneCount?: number[]): RatioGrid {
  return {
    width: 4,
    height: 4,
    ratio,
    sceneCount: sceneCount ?? ratio.map(() => 10),
    bbox: [0, 0, 4, 4],
  };
}

const SHALLOW = 1.0;
const DEEP = 1.4;

/** Left half shallow, right half deep. */
const LEFT_SHALLOW = [
  SHALLOW,
  SHALLOW,
  DEEP,
  DEEP,
  SHALLOW,
  SHALLOW,
  DEEP,
  DEEP,
  SHALLOW,
  SHALLOW,
  DEEP,
  DEEP,
  SHALLOW,
  SHALLOW,
  DEEP,
  DEEP,
];

function contains(geometry: GeoJSON.MultiPolygon, lon: number, lat: number): boolean {
  return booleanPointInPolygon([lon, lat], geometry);
}

describe("shallowWaterContour", () => {
  it("encloses water below the threshold and excludes water above it", () => {
    const contour = shallowWaterContour(grid(LEFT_SHALLOW), 1.2);
    expect(contour.type).toBe("MultiPolygon");
    expect(contains(contour, 0.5, 2)).toBe(true);
    expect(contains(contour, 3.5, 2)).toBe(false);
  });

  it("grows as the threshold is raised", () => {
    const tight = shallowWaterContour(grid(LEFT_SHALLOW), 0.9);
    const loose = shallowWaterContour(grid(LEFT_SHALLOW), 1.5);
    expect(tight.coordinates.length).toBe(0);
    expect(loose.coordinates.length).toBeGreaterThan(0);
    expect(contains(loose, 3.5, 2)).toBe(true);
  });

  it("excludes land, which would otherwise read as the shallowest water", () => {
    // Right half is land: ratio 0 with no contributing scenes. A naive contour
    // would classify it as shallower than anything and swallow the coastline.
    const ratio = [
      SHALLOW,
      SHALLOW,
      0,
      0,
      SHALLOW,
      SHALLOW,
      0,
      0,
      SHALLOW,
      SHALLOW,
      0,
      0,
      SHALLOW,
      SHALLOW,
      0,
      0,
    ];
    const scenes = [10, 10, 0, 0, 10, 10, 0, 0, 10, 10, 0, 0, 10, 10, 0, 0];
    const contour = shallowWaterContour(grid(ratio, scenes), 1.2);
    expect(contains(contour, 0.5, 2)).toBe(true);
    expect(contains(contour, 3.5, 2)).toBe(false);
  });

  it("honours a minimum scene count so thin data is not contoured", () => {
    const scenes = LEFT_SHALLOW.map(() => 2);
    const contour = shallowWaterContour(grid(LEFT_SHALLOW, scenes), 1.2, { minSceneCount: 5 });
    expect(contour.coordinates.length).toBe(0);
  });

  it("returns lon/lat within the bbox, with north at row 0", () => {
    const contour = shallowWaterContour(grid(LEFT_SHALLOW), 1.2);
    const points = contour.coordinates.flat(2);
    expect(points.length).toBeGreaterThan(0);
    for (const [lon, lat] of points) {
      expect(lon).toBeGreaterThanOrEqual(0);
      expect(lon).toBeLessThanOrEqual(4);
      expect(lat).toBeGreaterThanOrEqual(0);
      expect(lat).toBeLessThanOrEqual(4);
    }
  });

  it("returns an empty MultiPolygon when nothing qualifies", () => {
    const contour = shallowWaterContour(grid(LEFT_SHALLOW.map(() => DEEP)), 1.0);
    expect(contour.coordinates).toEqual([]);
  });
});

describe("countVertices", () => {
  it("counts every vertex across rings and polygons", () => {
    const square: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      ],
    };
    expect(countVertices(square)).toBe(4);
  });

  it("counts a real contour's vertices", () => {
    const contour = shallowWaterContour(grid(LEFT_SHALLOW), 1.2);
    expect(countVertices(contour)).toBeGreaterThan(3);
  });
});

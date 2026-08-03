import { describe, expect, it } from "vitest";
import { parseAoiInput, parseBboxInput } from "./bbox-input.js";

describe("parseBboxInput", () => {
  it("parses comma-separated numbers", () => {
    expect(parseBboxInput("23.105,37.418,23.14,37.435")).toEqual([23.105, 37.418, 23.14, 37.435]);
  });

  it("parses whitespace-separated numbers", () => {
    expect(parseBboxInput("23.105 37.418 23.14 37.435")).toEqual([23.105, 37.418, 23.14, 37.435]);
  });

  it("parses a bare bbox JSON array", () => {
    expect(parseBboxInput("[23.105, 37.418, 23.14, 37.435]")).toEqual([
      23.105, 37.418, 23.14, 37.435,
    ]);
  });

  it("parses a GeoJSON Polygon", () => {
    const polygon = {
      type: "Polygon",
      coordinates: [
        [
          [23.105, 37.418],
          [23.14, 37.418],
          [23.14, 37.435],
          [23.105, 37.435],
          [23.105, 37.418],
        ],
      ],
    };
    expect(parseBboxInput(JSON.stringify(polygon))).toEqual([23.105, 37.418, 23.14, 37.435]);
  });

  it("parses a GeoJSON Feature", () => {
    const feature = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [23.105, 37.418],
            [23.14, 37.418],
            [23.14, 37.435],
            [23.105, 37.435],
            [23.105, 37.418],
          ],
        ],
      },
    };
    expect(parseBboxInput(JSON.stringify(feature))).toEqual([23.105, 37.418, 23.14, 37.435]);
  });

  it("rejects empty input", () => {
    expect(() => parseBboxInput("")).toThrow(/Paste an area/);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseBboxInput("{not json")).toThrow(/valid JSON/);
  });

  it("rejects the wrong number of values", () => {
    expect(() => parseBboxInput("23.1, 37.4, 23.2")).toThrow(/four numbers/);
  });

  it("rejects out-of-range coordinates", () => {
    expect(() => parseBboxInput("23.1, 37.4, 23.2, 200")).toThrow(/valid lon\/lat range/);
  });

  it("rejects an inverted bbox", () => {
    expect(() => parseBboxInput("23.2, 37.4, 23.1, 37.5")).toThrow(/inverted/);
  });

  it("rejects an inverted bare bbox array rather than normalising it", () => {
    // `aoiEnvelope` returns min/max, so building the rectangle first would turn
    // a swapped pair into a perfectly valid box pointing somewhere else.
    expect(() => parseBboxInput("[23.2, 37.4, 23.1, 37.5]")).toThrow(/inverted/);
  });
});

describe("parseAoiInput", () => {
  /** Kiladha Bay's rough outline: five corners, emphatically not a rectangle. */
  const bay: GeoJSON.Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [23.105, 37.418],
        [23.14, 37.42],
        [23.135, 37.435],
        [23.11, 37.432],
        [23.105, 37.418],
      ],
    ],
  };

  it("keeps a pasted polygon's shape instead of its envelope (D10)", () => {
    // The bug this story exists to fix: `turfBbox` used to run here, so tracing
    // the bay in QGIS and pasting it gave you a rectangle back.
    const { polygon, bbox } = parseAoiInput(JSON.stringify(bay));

    expect(polygon).toEqual(bay);
    expect(bbox).toEqual([23.105, 37.418, 23.14, 37.435]);
  });

  it("unwraps a Feature", () => {
    const feature = { type: "Feature", properties: {}, geometry: bay };
    expect(parseAoiInput(JSON.stringify(feature)).polygon).toEqual(bay);
  });

  it("expands four numbers into a rectangle", () => {
    const { polygon } = parseAoiInput("23.105,37.418,23.14,37.435");
    expect(polygon.coordinates[0]).toHaveLength(5);
    expect(polygon.coordinates[0][0]).toEqual([23.105, 37.418]);
  });

  it("takes the largest polygon of a FeatureCollection, and says so", () => {
    const speck: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [23.106, 37.419],
          [23.107, 37.419],
          [23.107, 37.42],
          [23.106, 37.419],
        ],
      ],
    };
    const collection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: speck },
        { type: "Feature", properties: {}, geometry: bay },
      ],
    };

    const { polygon, note } = parseAoiInput(JSON.stringify(collection));

    expect(polygon).toEqual(bay);
    expect(note).toMatch(/2 polygons/);
  });

  it("ignores non-polygonal features rather than failing on them", () => {
    // A QGIS export routinely carries stray markers alongside the shape.
    const collection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [23.1, 37.4] } },
        { type: "Feature", properties: {}, geometry: bay },
      ],
    };

    const { polygon, note } = parseAoiInput(JSON.stringify(collection));
    expect(polygon).toEqual(bay);
    expect(note).toBeUndefined();
  });

  it("flattens a MultiPolygon to its largest piece", () => {
    const multi = {
      type: "MultiPolygon",
      coordinates: [
        bay.coordinates,
        [
          [
            [23.2, 37.5],
            [23.201, 37.5],
            [23.201, 37.501],
            [23.2, 37.5],
          ],
        ],
      ],
    };
    expect(parseAoiInput(JSON.stringify(multi)).polygon).toEqual(bay);
  });

  it("rejects GeoJSON with no polygon in it", () => {
    const point = { type: "Point", coordinates: [23.1, 37.4] };
    expect(() => parseAoiInput(JSON.stringify(point))).toThrow(/find a polygon/);
  });
});

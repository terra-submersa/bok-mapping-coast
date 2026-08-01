import { describe, expect, it } from "vitest";
import { parseBboxInput } from "./bbox-input.js";

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
    expect(() => parseBboxInput("")).toThrow(/Paste a bounding box/);
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
});

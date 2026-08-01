import { describe, expect, it } from "vitest";
import { boundaryKml } from "./boundary-kml.js";

const SQUARE: GeoJSON.Polygon = {
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

describe("boundaryKml", () => {
  it("emits a single Placemark with one Polygon", () => {
    const kml = boundaryKml(SQUARE);
    expect(kml.match(/<Placemark>/g)).toHaveLength(1);
    expect(kml.match(/<Polygon>/g)).toHaveLength(1);
    expect(kml).not.toContain("MultiGeometry");
    expect(kml).not.toContain("innerBoundaryIs");
  });

  it("declares the OGC KML 2.2 namespace and an XML prolog", () => {
    const kml = boundaryKml(SQUARE);
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(kml).toContain('xmlns="http://www.opengis.net/kml/2.2"');
  });

  it("writes lon,lat,alt triplets clamped to the ground", () => {
    const kml = boundaryKml(SQUARE);
    expect(kml).toContain("<altitudeMode>clampToGround</altitudeMode>");
    expect(kml).toContain("23.105000,37.418000,0");
  });

  it("emits no waypoints — Pilot 2 plans the lines itself", () => {
    const kml = boundaryKml(SQUARE);
    expect(kml).not.toContain("<Point>");
    expect(kml).not.toContain("wpml");
  });

  it("closes a ring that was left open", () => {
    const open: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [23.1, 37.4],
          [23.2, 37.4],
          [23.2, 37.5],
        ],
      ],
    };
    const coordinates = /<coordinates>([^<]*)<\/coordinates>/.exec(boundaryKml(open))?.[1] ?? "";
    const points = coordinates.split(" ");
    expect(points).toHaveLength(4);
    expect(points[0]).toBe(points[points.length - 1]);
  });

  it("does not duplicate an already-closed ring", () => {
    const coordinates = /<coordinates>([^<]*)<\/coordinates>/.exec(boundaryKml(SQUARE))?.[1] ?? "";
    expect(coordinates.split(" ")).toHaveLength(5);
  });

  it("escapes XML metacharacters in the name and description", () => {
    const kml = boundaryKml(SQUARE, { name: 'Kiladha & "Bay" <test>', description: "a < b" });
    expect(kml).toContain("Kiladha &amp; &quot;Bay&quot; &lt;test&gt;");
    expect(kml).toContain("a &lt; b");
  });

  it("omits the description element when none is given", () => {
    expect(boundaryKml(SQUARE)).not.toContain("<description>");
  });

  it("refuses a degenerate boundary", () => {
    const line: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [23.1, 37.4],
          [23.2, 37.4],
        ],
      ],
    };
    expect(() => boundaryKml(line)).toThrow(/at least three/);
  });
});

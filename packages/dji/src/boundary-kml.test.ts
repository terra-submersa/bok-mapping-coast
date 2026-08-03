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

/** Two disjoint survey areas — the normal case since issue #33. */
const TWO_PIECES: GeoJSON.MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    SQUARE.coordinates,
    [
      [
        [23.3, 37.5],
        [23.32, 37.5],
        [23.32, 37.52],
        [23.3, 37.52],
        [23.3, 37.5],
      ],
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

  it("emits one Placemark per disjoint piece (issue #33)", () => {
    const kml = boundaryKml(TWO_PIECES);
    expect(kml.match(/<Placemark>/g)).toHaveLength(2);
    expect(kml.match(/<Polygon>/g)).toHaveLength(2);
    // Both pieces' coordinates are actually written, not just the first.
    expect(kml).toContain("23.105000,37.418000,0");
    expect(kml).toContain("23.300000,37.500000,0");
  });

  it("numbers the pieces so Pilot 2's import list is readable", () => {
    const kml = boundaryKml(TWO_PIECES, { name: "Kiladha" });
    expect(kml).toContain("<name>Kiladha 1 of 2</name>");
    expect(kml).toContain("<name>Kiladha 2 of 2</name>");
  });

  it("leaves a single piece unnumbered", () => {
    const single: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [SQUARE.coordinates],
    };
    const kml = boundaryKml(single, { name: "Kiladha" });
    expect(kml).toContain("<name>Kiladha</name>");
    expect(kml).not.toContain("1 of 1");
  });

  it("drops holes per piece — Pilot 2 has no use for a cut-out island", () => {
    const donut: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [
          SQUARE.coordinates[0],
          [
            [23.11, 37.42],
            [23.13, 37.42],
            [23.13, 37.43],
            [23.11, 37.43],
            [23.11, 37.42],
          ],
        ],
      ],
    };
    const kml = boundaryKml(donut);
    expect(kml).not.toContain("innerBoundaryIs");
    expect(kml.match(/<LinearRing>/g)).toHaveLength(1);
  });

  it("skips a degenerate piece rather than failing the whole export", () => {
    const withRunt: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        SQUARE.coordinates,
        [
          [
            [23.3, 37.5],
            [23.31, 37.5],
          ],
        ],
      ],
    };
    const kml = boundaryKml(withRunt);
    expect(kml.match(/<Placemark>/g)).toHaveLength(1);
    expect(kml).toContain("23.105000,37.418000,0");
  });

  it("still refuses a boundary with no usable piece at all", () => {
    const allRunts: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [23.1, 37.4],
            [23.2, 37.4],
          ],
        ],
      ],
    };
    expect(() => boundaryKml(allRunts)).toThrow(/at least three/);
  });
});

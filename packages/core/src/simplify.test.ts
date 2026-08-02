import { describe, expect, it } from "vitest";
import { countVertices } from "./contour.js";
import { simplifyContour } from "./simplify.js";

/** A ring around Kiladha-ish coordinates with many near-collinear points. */
function noisyRing(points: number): GeoJSON.MultiPolygon {
  const ring: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const t = (i / points) * Math.PI * 2;
    // Radius wobbles by a few metres so simplification has something to remove.
    const r = 0.004 + (i % 2 === 0 ? 0.000005 : -0.000005);
    ring.push([23.12 + r * Math.cos(t), 37.4265 + r * Math.sin(t)]);
  }
  ring.push(ring[0]);
  return { type: "MultiPolygon", coordinates: [[ring]] };
}

describe("simplifyContour", () => {
  it("reduces the vertex count", () => {
    const original = noisyRing(500);
    const simplified = simplifyContour(original, 20);
    expect(countVertices(simplified)).toBeLessThan(countVertices(original));
  });

  it("removes more as the tolerance grows", () => {
    const original = noisyRing(500);
    const gentle = countVertices(simplifyContour(original, 5));
    const aggressive = countVertices(simplifyContour(original, 100));
    expect(aggressive).toBeLessThan(gentle);
  });

  it("leaves the original untouched", () => {
    const original = noisyRing(300);
    const before = JSON.parse(JSON.stringify(original));
    simplifyContour(original, 50);
    expect(original).toEqual(before);
  });

  it("returns a copy, not the same object, at zero tolerance", () => {
    const original = noisyRing(20);
    const result = simplifyContour(original, 0);
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
  });

  it("keeps rings closed", () => {
    const simplified = simplifyContour(noisyRing(400), 30);
    for (const polygon of simplified.coordinates) {
      for (const ring of polygon) {
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        expect(ring.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("drops rings that collapse below a valid ring rather than emitting them", () => {
    // A tolerance far larger than the feature itself.
    const simplified = simplifyContour(noisyRing(50), 100_000);
    for (const polygon of simplified.coordinates) {
      for (const ring of polygon) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("handles an empty contour", () => {
    expect(simplifyContour({ type: "MultiPolygon", coordinates: [] }, 25).coordinates).toEqual([]);
  });

  it("accepts a single Polygon and returns a Polygon", () => {
    const [ring] = noisyRing(500).coordinates;
    const original: GeoJSON.Polygon = { type: "Polygon", coordinates: ring };
    const simplified = simplifyContour(original, 20);
    expect(simplified.type).toBe("Polygon");
    expect(countVertices(simplified)).toBeLessThan(countVertices(original));
  });

  it("drops a Polygon ring that collapses below a valid ring rather than emitting it invalid", () => {
    const [ring] = noisyRing(50).coordinates;
    const original: GeoJSON.Polygon = { type: "Polygon", coordinates: ring };
    const simplified = simplifyContour(original, 100_000);
    if (simplified.coordinates.length > 0) {
      expect(simplified.coordinates[0].length).toBeGreaterThanOrEqual(4);
    }
  });
});

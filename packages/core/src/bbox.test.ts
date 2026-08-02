import { describe, expect, it } from "vitest";
import { type BBox, bboxAreaKm2, sameBbox } from "./bbox.js";

describe("bboxAreaKm2", () => {
  it("computes the area of the Kiladha Bay spike AOI as a few km²", () => {
    // Same bbox as scripts/spike-sdb-kiladha.mjs.
    const kiladhaBay: [number, number, number, number] = [23.105, 37.418, 23.14, 37.435];
    expect(bboxAreaKm2(kiladhaBay)).toBeCloseTo(5.84, 1);
  });

  it("returns 0 for a degenerate bbox", () => {
    expect(bboxAreaKm2([23.1, 37.4, 23.1, 37.4])).toBe(0);
  });
});

describe("sameBbox", () => {
  const kiladhaBay: BBox = [23.105, 37.418, 23.14, 37.435];

  it("is true for the same box", () => {
    expect(sameBbox(kiladhaBay, [...kiladhaBay])).toBe(true);
  });

  it("is true for two absent boxes", () => {
    expect(sameBbox(null, null)).toBe(true);
  });

  it("is false when one box is absent", () => {
    expect(sameBbox(kiladhaBay, null)).toBe(false);
    expect(sameBbox(null, kiladhaBay)).toBe(false);
  });

  it("is false for a box nudged by a fraction of a pixel", () => {
    // 1e-7° is ~1 cm — far under a 10 m pixel, but it still shifts the grid the
    // composite was fetched on, so it must count as a different AOI.
    expect(sameBbox(kiladhaBay, [23.1050001, 37.418, 23.14, 37.435])).toBe(false);
  });

  it("is false when a single corner differs", () => {
    expect(sameBbox(kiladhaBay, [23.105, 37.418, 23.14, 37.44])).toBe(false);
  });
});

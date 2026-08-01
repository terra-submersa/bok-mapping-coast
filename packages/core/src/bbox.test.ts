import { describe, expect, it } from "vitest";
import { bboxAreaKm2 } from "./bbox.js";

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

import { describe, expect, it } from "vitest";
import { normalise, percentileRange } from "./stretch.js";

describe("percentileRange", () => {
  it("returns null for no values", () => {
    expect(percentileRange([])).toBeNull();
  });

  it("clips outliers that would otherwise flatten the ramp", () => {
    // 99 values in [0, 1] plus one absurd outlier — the kind a glint pixel produces.
    const values = [...Array.from({ length: 99 }, (_, i) => i / 98), 1000];
    const range = percentileRange(values, 2, 98);
    expect(range).not.toBeNull();
    if (!range) return;
    expect(range.max).toBeLessThan(2);
  });

  it("spans the data when asked for the full range", () => {
    const range = percentileRange([1, 2, 3, 4, 5], 0, 100);
    expect(range).toEqual({ min: 1, max: 5 });
  });

  it("never returns a zero-width range", () => {
    const range = percentileRange([0.7, 0.7, 0.7]);
    expect(range).not.toBeNull();
    if (!range) return;
    expect(range.max).toBeGreaterThan(range.min);
  });
});

describe("normalise", () => {
  const range = { min: 10, max: 20 };

  it("maps the range onto 0..1", () => {
    expect(normalise(10, range)).toBe(0);
    expect(normalise(15, range)).toBe(0.5);
    expect(normalise(20, range)).toBe(1);
  });

  it("clamps values outside the range", () => {
    expect(normalise(-5, range)).toBe(0);
    expect(normalise(999, range)).toBe(1);
  });
});

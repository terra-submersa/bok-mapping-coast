import type { DepthContourPlan } from "@bok/core";
import { describe, expect, it } from "vitest";
import { formatDepthM } from "../lib/format.js";
import { contourMenuNote } from "./ContourMenu.js";

function plan(overrides: Partial<DepthContourPlan> = {}): DepthContourPlan {
  return {
    levels: [
      { depthM: 1, ratio: 1.1 },
      { depthM: 2, ratio: 1.2 },
    ],
    availableCount: 2,
    capped: false,
    extentM: { min: 0.4, max: 2.6 },
    ...overrides,
  };
}

describe("contourMenuNote", () => {
  it("asks for a composite first", () => {
    expect(contourMenuNote(plan(), false, 1)?.text).toMatch(/Load a composite/);
  });

  /** D3: without three points and a positive slope there are no metres, and it says so. */
  it("points at the Calibrate step when there is no usable fit", () => {
    const note = contourMenuNote(plan({ levels: [], extentM: null }), true, 1);
    expect(note?.text).toMatch(/at least 3 known-depth reference points/);
    expect(note?.calibrate).toBe(true);
  });

  it("says when no multiple of the interval falls in range", () => {
    const note = contourMenuNote(
      plan({ levels: [], availableCount: 0, extentM: { min: 0.2, max: 0.8 } }),
      true,
      5,
    );
    expect(note?.text).toMatch(/No whole multiple of 5 m falls between 0.2 m and 0.8 m/);
  });

  it("says how many lines the cap dropped, and where they stopped", () => {
    const note = contourMenuNote(plan({ capped: true, availableCount: 96 }), true, 0.5);
    expect(note?.text).toMatch(/Showing 2 of 96 lines — deeper than 2.0 m omitted/);
  });

  it("stays quiet when nothing is wrong", () => {
    expect(contourMenuNote(plan(), true, 1)).toBeNull();
  });

  it("prefers the missing composite over the missing fit", () => {
    // Both are true before anything is loaded; the composite is the first thing to do.
    const note = contourMenuNote(plan({ levels: [], extentM: null }), false, 1);
    expect(note?.text).toMatch(/Load a composite/);
  });
});

describe("formatDepthM", () => {
  it("drops trailing zeros so a map label reads as a depth", () => {
    expect(formatDepthM(1)).toBe("1 m");
    expect(formatDepthM(0.5)).toBe("0.5 m");
    expect(formatDepthM(1.5000000000000002)).toBe("1.5 m");
    expect(formatDepthM(20)).toBe("20 m");
  });
});

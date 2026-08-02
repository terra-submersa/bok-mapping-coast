import { describe, expect, it } from "vitest";
import type { Composite } from "./composite.js";
import {
  rampColour,
  renderCompositeRgba,
  renderSceneCountRgba,
  sceneCountRampColour,
  sceneCountRange,
  waterRange,
} from "./depth-ramp.js";

function composite(ratio: number[], sceneCount: number[]): Composite {
  return {
    width: ratio.length,
    height: 1,
    ratio: Float32Array.from(ratio),
    sceneCount: Float32Array.from(sceneCount),
    bbox: [23.105, 37.418, 23.14, 37.435],
  };
}

describe("rampColour", () => {
  it("runs from pale sand at 0 to deep blue at 1", () => {
    const [r0, g0, b0] = rampColour(0);
    const [r1, g1, b1] = rampColour(1);
    expect(r0 + g0 + b0).toBeGreaterThan(r1 + g1 + b1);
    expect(b1).toBeGreaterThan(r1);
  });

  it("clamps out-of-range positions to the ends", () => {
    expect(rampColour(-1)).toEqual(rampColour(0));
    expect(rampColour(5)).toEqual(rampColour(1));
  });

  it("interpolates between stops rather than stepping", () => {
    const mid = rampColour(0.125);
    expect(mid).not.toEqual(rampColour(0));
    expect(mid).not.toEqual(rampColour(0.25));
  });
});

describe("waterRange", () => {
  it("ignores pixels with no contributing scenes", () => {
    // The 999 values are land — they must not stretch the ramp.
    const range = waterRange(composite([1, 1.1, 999, 999], [10, 10, 0, 0]));
    expect(range).not.toBeNull();
    if (!range) return;
    expect(range.max).toBeLessThan(2);
  });

  it("returns null when nothing is water", () => {
    expect(waterRange(composite([999, 999], [0, 0]))).toBeNull();
  });
});

describe("renderCompositeRgba", () => {
  const range = { min: 1, max: 2 };

  it("makes no-data pixels fully transparent", () => {
    const rgba = renderCompositeRgba(composite([1.5, 1.5], [4, 0]), range);
    expect(rgba[3]).toBe(255);
    expect(rgba[7]).toBe(0);
  });

  it("colours shallow and deep pixels differently and opaquely", () => {
    const rgba = renderCompositeRgba(composite([1, 2], [4, 4]), range);
    const shallow = [rgba[0], rgba[1], rgba[2]];
    const deep = [rgba[4], rgba[5], rgba[6]];
    expect(shallow).not.toEqual(deep);
    expect(rgba[3]).toBe(255);
    expect(rgba[7]).toBe(255);
  });

  it("honours a minimum scene count, so thin data can be hidden", () => {
    const rgba = renderCompositeRgba(composite([1.5, 1.5], [2, 20]), range, { minSceneCount: 5 });
    expect(rgba[3]).toBe(0);
    expect(rgba[7]).toBe(255);
  });
});

describe("sceneCountRampColour", () => {
  it("runs from a warning red at 0 to a reassuring green at 1", () => {
    const [r0, g0] = sceneCountRampColour(0);
    const [r1, g1] = sceneCountRampColour(1);
    expect(r0).toBeGreaterThan(g0);
    expect(g1).toBeGreaterThan(r1);
  });
});

describe("sceneCountRange", () => {
  it("ignores land pixels and uses the full min–max of water pixels", () => {
    const range = sceneCountRange(composite([1, 1, 1, 1], [2, 8, 0, 0]));
    expect(range).toEqual({ min: 2, max: 8 });
  });

  it("returns null when nothing is water", () => {
    expect(sceneCountRange(composite([1, 1], [0, 0]))).toBeNull();
  });
});

describe("renderSceneCountRgba", () => {
  const range = { min: 1, max: 10 };

  it("makes land pixels fully transparent", () => {
    const rgba = renderSceneCountRgba(composite([1, 1], [5, 0]), range);
    expect(rgba[3]).toBe(255);
    expect(rgba[7]).toBe(0);
  });

  it("colours a thin pixel and a well-supported pixel differently and opaquely", () => {
    const rgba = renderSceneCountRgba(composite([1, 1], [1, 10]), range);
    const thin = [rgba[0], rgba[1], rgba[2]];
    const solid = [rgba[4], rgba[5], rgba[6]];
    expect(thin).not.toEqual(solid);
    expect(rgba[3]).toBe(255);
    expect(rgba[7]).toBe(255);
  });
});

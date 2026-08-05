import { describe, expect, it } from "vitest";
import type { Composite } from "./composite.js";
import {
  displayGrid,
  MAX_DISPLAY_SIDE,
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

/** A raster of a given shape whose ratio is the pixel index, so sampling is traceable. */
function grid(width: number, height: number): Composite {
  const size = width * height;
  const ratio = new Float32Array(size);
  const sceneCount = new Float32Array(size).fill(1);
  for (let i = 0; i < size; i++) ratio[i] = i;
  return { width, height, ratio, sceneCount, bbox: [23.105, 37.418, 23.14, 37.435] };
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

describe("displayGrid", () => {
  it("leaves a small raster alone", () => {
    expect(displayGrid({ width: 370, height: 190 })).toEqual({
      stride: 1,
      width: 370,
      height: 190,
    });
  });

  it("decimates only once the longest side passes the cap", () => {
    expect(displayGrid({ width: MAX_DISPLAY_SIDE, height: 10 }).stride).toBe(1);
    expect(displayGrid({ width: MAX_DISPLAY_SIDE + 1, height: 10 }).stride).toBe(2);
  });

  it("keeps a 3x3 mosaic under the cap on both sides", () => {
    const shown = displayGrid({ width: 7500, height: 7500 });
    expect(shown.stride).toBe(4);
    expect(shown.width).toBeLessThanOrEqual(MAX_DISPLAY_SIDE);
    expect(shown.height).toBeLessThanOrEqual(MAX_DISPLAY_SIDE);
  });

  it("decimates by the longest side, so the aspect ratio survives", () => {
    const shown = displayGrid({ width: 8000, height: 2000 });
    expect(shown.width / shown.height).toBeCloseTo(4, 1);
  });

  it("honours an explicit cap", () => {
    expect(displayGrid({ width: 100, height: 100 }, 10)).toEqual({
      stride: 10,
      width: 10,
      height: 10,
    });
  });
});

describe("strided rendering", () => {
  it("emits exactly the display grid's pixels, not the raster's", () => {
    const source = grid(100, 100);
    const display = displayGrid(source, 10);
    const rgba = renderCompositeRgba(source, { min: 0, max: 9999 }, { display });
    expect(rgba.length).toBe(10 * 10 * 4);
  });

  it("samples the top-left pixel of each block", () => {
    const source = grid(4, 4);
    const display = { stride: 2, width: 2, height: 2 };
    const rgba = renderCompositeRgba(source, { min: 0, max: 15 }, { display });

    // Row 1 of the display is row 2 of the source, so its first pixel is index 8.
    const expected = rampColour(8 / 15);
    expect([rgba[8], rgba[9], rgba[10]]).toEqual(expected);
  });

  it("is unchanged at stride 1", () => {
    const source = grid(4, 4);
    const strided = renderCompositeRgba(
      source,
      { min: 0, max: 15 },
      { display: displayGrid(source) },
    );
    const plain = renderCompositeRgba(source, { min: 0, max: 15 });
    expect(Array.from(strided)).toEqual(Array.from(plain));
  });

  it("carries transparency through the decimation", () => {
    const source = grid(4, 4);
    source.sceneCount[0] = 0;
    const rgba = renderCompositeRgba(
      source,
      { min: 0, max: 15 },
      { display: { stride: 2, width: 2, height: 2 } },
    );
    expect(rgba[3]).toBe(0);
    expect(rgba[7]).toBe(255);
  });

  it("decimates the scene-count layer the same way", () => {
    const source = grid(100, 100);
    const rgba = renderSceneCountRgba(
      source,
      { min: 0, max: 2 },
      { display: displayGrid(source, 10) },
    );
    expect(rgba.length).toBe(10 * 10 * 4);
  });
});

describe("range sampling on large rasters", () => {
  /** 1.2M pixels: past the sampling threshold, but cheap enough for a unit test. */
  const large = () => grid(1200, 1000);

  it("returns a range close to the exact one", () => {
    const source = large();
    const range = waterRange(source);
    expect(range).not.toBeNull();
    if (!range) return;
    // Ratio is the pixel index over 1.2M values, so the 2nd and 98th percentiles are
    // predictable regardless of which subset was sampled.
    expect(range.min).toBeGreaterThan(0);
    expect(range.min).toBeLessThan(source.ratio.length * 0.05);
    expect(range.max).toBeGreaterThan(source.ratio.length * 0.95);
  });

  it("does not sample a single column", () => {
    // A stride equal to the row width would read one column of the bay and call it the
    // whole stretch. The nudge in sampleStride is what stops that.
    const source = grid(2, 1_000_000);
    const range = waterRange(source);
    expect(range).not.toBeNull();
    if (!range) return;
    // Both columns carry different values, so a one-column sample would halve the spread.
    expect(range.max - range.min).toBeGreaterThan(source.ratio.length * 0.9);
  });

  it("still ignores land", () => {
    const source = large();
    source.sceneCount.fill(0);
    expect(waterRange(source)).toBeNull();
    expect(sceneCountRange(source)).toBeNull();
  });

  it("is exact below the threshold", () => {
    const small = composite([1, 5, 9], [1, 1, 1]);
    expect(waterRange(small)).toEqual({ min: 1, max: 9 });
  });
});

/**
 * Five NaN pixels in 6.8 million blanked the entire depth layer on the first real
 * multi-tile load (issue #44). The evalscript rejects B02 <= 0, but B02 = B03 = 0.001
 * passes that and yields ln(1)/ln(1) = 0/0.
 */
describe("non-finite ratios", () => {
  it("draws a NaN pixel transparent rather than throwing", () => {
    const rgba = renderCompositeRgba(composite([1.5, Number.NaN], [8, 8]), { min: 1, max: 2 });
    expect(rgba[3]).toBe(255);
    expect(rgba[7]).toBe(0);
  });

  it("draws an infinite pixel transparent too", () => {
    const rgba = renderCompositeRgba(composite([1.5, Number.POSITIVE_INFINITY], [8, 8]), {
      min: 1,
      max: 2,
    });
    expect(rgba[7]).toBe(0);
  });

  it("keeps a NaN out of the ramp stretch", () => {
    // TypedArray sort puts NaN last, so an unfiltered NaN becomes the maximum.
    const range = waterRange(composite([1, 1.1, 1.2, Number.NaN], [8, 8, 8, 8]));
    expect(range).not.toBeNull();
    if (!range) return;
    expect(Number.isFinite(range.min)).toBe(true);
    expect(Number.isFinite(range.max)).toBe(true);
    // The composite helper stores Float32, so 1.2 comes back as 1.2000000476837158.
    expect(range.max).toBeCloseTo(1.2, 5);
  });

  it("returns null when every water pixel is non-finite", () => {
    expect(waterRange(composite([Number.NaN, Number.NaN], [8, 8]))).toBeNull();
  });

  it("clamps a non-finite ramp position instead of indexing out of bounds", () => {
    expect(() => rampColour(Number.NaN)).not.toThrow();
    expect(rampColour(Number.NaN)).toEqual(rampColour(0));
  });

  it("survives a whole-raster render with a NaN in it", () => {
    const source = grid(64, 64);
    source.ratio[500] = Number.NaN;
    expect(() => renderCompositeRgba(source, { min: 0, max: 4095 })).not.toThrow();
  });
});

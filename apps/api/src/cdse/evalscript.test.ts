import { describe, expect, it } from "vitest";
import { SDB_EVALSCRIPT, STUMPF_N } from "./evalscript.js";

interface Sample {
  B02: number;
  B03: number;
  B08: number;
  SCL: number;
}

interface EvalscriptExports {
  setup: () => {
    input: { bands: string[] }[];
    output: { bands: number; sampleType: string };
    mosaicking: string;
  };
  evaluatePixel: (samples: Sample[]) => number[];
}

/**
 * Runs the evalscript the way Sentinel Hub does — as a standalone script whose
 * top-level function declarations are the entry points.
 */
function loadEvalscript(): EvalscriptExports {
  return new Function(
    `${SDB_EVALSCRIPT}; return { setup: setup, evaluatePixel: evaluatePixel };`,
  )();
}

/** Clear, shallow water: bright in blue and green, dark in NIR so NDWI > 0. */
function waterSample(overrides: Partial<Sample> = {}): Sample {
  return { B02: 0.12, B03: 0.1, B08: 0.02, SCL: 6, ...overrides };
}

function stumpfRatio(sample: Sample): number {
  return Math.log(STUMPF_N * sample.B02) / Math.log(STUMPF_N * sample.B03);
}

describe("SDB evalscript setup", () => {
  it("requests the bands the Stumpf ratio and masks need, per orbit", () => {
    const { setup } = loadEvalscript();
    const config = setup();
    expect(config.input[0].bands).toEqual(["B02", "B03", "B08", "SCL"]);
    // ORBIT mosaicking is what gives evaluatePixel one sample per scene.
    expect(config.mosaicking).toBe("ORBIT");
  });

  it("emits two float bands: ratio and scene count", () => {
    const { setup } = loadEvalscript();
    expect(setup().output).toEqual({ bands: 2, sampleType: "FLOAT32" });
  });
});

describe("SDB evalscript evaluatePixel", () => {
  it("returns the Stumpf ratio and a count of 1 for a single clear water scene", () => {
    const { evaluatePixel } = loadEvalscript();
    const sample = waterSample();
    const [ratio, count] = evaluatePixel([sample]);
    expect(ratio).toBeCloseTo(stumpfRatio(sample), 10);
    expect(count).toBe(1);
  });

  it("takes the median across scenes, not the mean", () => {
    const { evaluatePixel } = loadEvalscript();
    // Three scenes where one is a wild outlier — glint, say. The median must
    // ignore it; a mean would be dragged towards it.
    const samples = [
      waterSample({ B02: 0.1 }),
      waterSample({ B02: 0.12 }),
      waterSample({ B02: 0.9 }),
    ];
    const [ratio, count] = evaluatePixel(samples);
    expect(count).toBe(3);
    expect(ratio).toBeCloseTo(stumpfRatio(waterSample({ B02: 0.12 })), 10);
  });

  it("averages the two middle scenes for an even count", () => {
    const { evaluatePixel } = loadEvalscript();
    const a = waterSample({ B02: 0.1 });
    const b = waterSample({ B02: 0.12 });
    const [ratio] = evaluatePixel([a, b]);
    expect(ratio).toBeCloseTo((stumpfRatio(a) + stumpfRatio(b)) / 2, 10);
  });

  it.each([
    ["saturated/defective", 1],
    ["cloud shadow", 3],
    ["cloud medium probability", 8],
    ["cloud high probability", 9],
    ["cirrus", 10],
    ["snow", 11],
  ])("drops %s scenes (SCL %i)", (_label, scl) => {
    const { evaluatePixel } = loadEvalscript();
    const good = waterSample();
    const [ratio, count] = evaluatePixel([good, waterSample({ SCL: scl, B02: 0.9 })]);
    expect(count).toBe(1);
    expect(ratio).toBeCloseTo(stumpfRatio(good), 10);
  });

  it("drops land, where NIR is high enough to push NDWI negative", () => {
    const { evaluatePixel } = loadEvalscript();
    const land = waterSample({ B03: 0.1, B08: 0.3 });
    expect(evaluatePixel([land])).toEqual([0, 0]);
  });

  it("drops non-positive reflectances that would break the logarithms", () => {
    const { evaluatePixel } = loadEvalscript();
    expect(evaluatePixel([waterSample({ B02: 0 })])).toEqual([0, 0]);
    expect(evaluatePixel([waterSample({ B03: -0.01 })])).toEqual([0, 0]);
  });

  it("returns a zero ratio and zero count when nothing qualifies", () => {
    const { evaluatePixel } = loadEvalscript();
    // A caller must be able to tell "no data" from a real ratio — hence band 2.
    expect(evaluatePixel([])).toEqual([0, 0]);
  });
});

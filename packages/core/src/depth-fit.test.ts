import { describe, expect, it } from "vitest";
import {
  type DepthFit,
  depthToRatio,
  fitDepth,
  MIN_CALIBRATION_POINTS,
  ratioToDepth,
  residuals,
} from "./depth-fit.js";

/** Points on an exact line: depth = 10·ratio − 2. */
function exact() {
  return [
    { ratio: 1.0, depthM: 8 },
    { ratio: 1.2, depthM: 10 },
    { ratio: 1.5, depthM: 13 },
    { ratio: 2.0, depthM: 18 },
  ];
}

describe("fitDepth", () => {
  it("recovers a line it was given exactly", () => {
    const fit = fitDepth(exact()) as DepthFit;
    expect(fit.m1).toBeCloseTo(10, 9);
    expect(fit.m0).toBeCloseTo(2, 9);
    expect(fit.r2).toBeCloseTo(1, 9);
    expect(fit.rmseM).toBeCloseTo(0, 9);
    expect(fit.n).toBe(4);
  });

  it("uses the sign convention depth = m1·ratio − m0", () => {
    const fit = fitDepth(exact()) as DepthFit;
    expect(ratioToDepth(fit, 1.2)).toBeCloseTo(10, 9);
  });

  it("refuses to fit under three points — D3's guardrail, in code", () => {
    expect(MIN_CALIBRATION_POINTS).toBe(3);
    expect(fitDepth(exact().slice(0, 2))).toBeNull();
    expect(fitDepth(exact().slice(0, 3))).not.toBeNull();
  });

  it("refuses when every reading is at the same ratio, where any slope fits", () => {
    const flat = [
      { ratio: 1.4, depthM: 1 },
      { ratio: 1.4, depthM: 2 },
      { ratio: 1.4, depthM: 3 },
    ];
    expect(fitDepth(flat)).toBeNull();
  });

  it("reports R² of 1 when every sounding is at the same depth", () => {
    // Undefined rather than zero: the flat line explains all of the nil variation.
    const fit = fitDepth([
      { ratio: 1.0, depthM: 3 },
      { ratio: 1.2, depthM: 3 },
      { ratio: 1.5, depthM: 3 },
    ]) as DepthFit;
    expect(fit.r2).toBe(1);
    expect(fit.m1).toBeCloseTo(0, 9);
  });

  it("drops non-finite readings rather than returning a NaN fit", () => {
    const withJunk = [...exact(), { ratio: Number.NaN, depthM: 4 }];
    const fit = fitDepth(withJunk) as DepthFit;
    expect(fit.n).toBe(4);
    expect(fit.m1).toBeCloseTo(10, 9);
  });

  it("falls under the gate once the junk is dropped", () => {
    expect(
      fitDepth([
        { ratio: 1, depthM: 1 },
        { ratio: 2, depthM: 2 },
        { ratio: Number.NaN, depthM: 3 },
      ]),
    ).toBeNull();
  });

  it("reports RMSE in metres for a scattered fit", () => {
    // OLS on these four gives depth = 0.6·ratio + 1, i.e. m1 = 0.6, m0 = −1. Residuals
    // are +0.4, −1.2, +1.2, −0.4, so RMSE = sqrt(3.2/4) = 0.894 m.
    const fit = fitDepth([
      { ratio: 1, depthM: 2 },
      { ratio: 2, depthM: 1 },
      { ratio: 3, depthM: 4 },
      { ratio: 4, depthM: 3 },
    ]) as DepthFit;
    expect(fit.m1).toBeCloseTo(0.6, 9);
    expect(fit.m0).toBeCloseTo(-1, 9);
    expect(fit.rmseM).toBeCloseTo(0.894427191, 6);
    expect(fit.r2).toBeGreaterThan(0);
    expect(fit.r2).toBeLessThan(1);
  });

  it("survives the shape of the real survey: shallow and deep at different ratios", () => {
    // Ratio increases with depth — the sign the Argolid data must have for any of this
    // to mean anything. A fit with a negative slope would say the satellite reads
    // deeper water as brighter, which is the opposite of Stumpf.
    const fit = fitDepth([
      { ratio: 1.02, depthM: 0.6 },
      { ratio: 1.08, depthM: 2.1 },
      { ratio: 1.14, depthM: 3.5 },
      { ratio: 1.19, depthM: 4.6 },
    ]) as DepthFit;
    expect(fit.m1).toBeGreaterThan(0);
    expect(fit.r2).toBeGreaterThan(0.99);
  });
});

describe("ratioToDepth / depthToRatio", () => {
  it("round-trips", () => {
    const fit = fitDepth(exact()) as DepthFit;
    const ratio = depthToRatio(fit, 4) as number;
    expect(ratioToDepth(fit, ratio)).toBeCloseTo(4, 9);
  });

  it("returns null for a flat fit rather than an infinite threshold", () => {
    const flat = fitDepth([
      { ratio: 1.0, depthM: 3 },
      { ratio: 1.2, depthM: 3 },
      { ratio: 1.5, depthM: 3 },
    ]) as DepthFit;
    expect(depthToRatio(flat, 4)).toBeNull();
  });
});

describe("residuals", () => {
  it("is zero on an exact fit", () => {
    const fit = fitDepth(exact()) as DepthFit;
    for (const residual of residuals(fit, exact())) expect(residual).toBeCloseTo(0, 9);
  });

  it("is positive where the seabed is deeper than the fit says", () => {
    const fit = fitDepth(exact()) as DepthFit;
    // depth = 10·1.2 − 2 = 10, so a 12 m reading is 2 m deeper than predicted.
    expect(residuals(fit, [{ ratio: 1.2, depthM: 12 }])[0]).toBeCloseTo(2, 9);
  });
});

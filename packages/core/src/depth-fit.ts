/**
 * Stumpf ratio to metres (issue #12).
 *
 * `depth = m1 · ratio − m0`, fitted by ordinary least squares against measured
 * soundings. The model is linear by assumption, not by observation: Stumpf's ratio of
 * log-transformed blue and green is *designed* to be linear in depth over a uniform
 * substrate. Kiladha's substrate is not uniform — sand, rock and Posidonia in one bay —
 * so the residuals are where the truth about this AOI shows up, and they are reported
 * rather than summarised away.
 */

/** Below this the app must not display metres at all. D3's guardrail, in code. */
export const MIN_CALIBRATION_POINTS = 3;

export interface FitPoint {
  ratio: number;
  /** True depth below the instantaneous surface, per D13. */
  depthM: number;
}

export interface DepthFit {
  /** Slope: metres per unit of ratio. */
  m1: number;
  /** Offset, subtracted — `depth = m1 · ratio − m0`, as CLAUDE.md states it. */
  m0: number;
  /** Coefficient of determination. 1 is a perfect line, 0 is no better than the mean. */
  r2: number;
  /** Root-mean-square residual, in metres — the number to quote as the fit's error. */
  rmseM: number;
  n: number;
}

/**
 * Fits ratio → depth, or returns null when a fit would be a lie.
 *
 * Null on three counts, all of them refusals rather than failures:
 *
 * - fewer than `MIN_CALIBRATION_POINTS` readings (D3);
 * - every reading at the same ratio, so the slope is unconstrained;
 * - a non-finite result, which no arithmetic here should produce but which would
 *   otherwise reach the UI as "NaN m".
 *
 * The gate lives here rather than in a component so it cannot be forgotten in a second
 * place — every caller that wants metres has to get past it.
 */
export function fitDepth(points: readonly FitPoint[]): DepthFit | null {
  const usable = points.filter((p) => Number.isFinite(p.ratio) && Number.isFinite(p.depthM));
  const n = usable.length;
  if (n < MIN_CALIBRATION_POINTS) return null;

  const meanRatio = usable.reduce((sum, p) => sum + p.ratio, 0) / n;
  const meanDepth = usable.reduce((sum, p) => sum + p.depthM, 0) / n;

  /**
   * Every point at one ratio: any slope fits equally, so there is no fit.
   *
   * Tested on the *spread*, against a relative tolerance, rather than on the variance
   * being exactly zero. Three readings all at ratio 1.4 do not produce a variance of 0 —
   * the mean of three copies of 1.4 is 1.3999999999999997, so each deviation is ~3e-16
   * and the "degenerate" case sails through an `=== 0` check to divide by 1e-31 and
   * return a slope of pure rounding error. Stumpf ratios sit around 1; anything varying
   * by less than a part in 1e12 is one number.
   */
  const ratios = usable.map((p) => p.ratio);
  const spread = Math.max(...ratios) - Math.min(...ratios);
  if (!(spread > Math.max(Math.abs(meanRatio), 1) * 1e-12)) return null;

  let covariance = 0;
  let variance = 0;
  for (const { ratio, depthM } of usable) {
    covariance += (ratio - meanRatio) * (depthM - meanDepth);
    variance += (ratio - meanRatio) ** 2;
  }
  if (variance === 0) return null;

  const m1 = covariance / variance;
  // `depth = m1 · ratio − m0`, so the intercept is negated: m0 = m1 · mean(ratio) − mean(depth).
  const m0 = m1 * meanRatio - meanDepth;

  let residualSum = 0;
  let totalSum = 0;
  for (const { ratio, depthM } of usable) {
    residualSum += (depthM - (m1 * ratio - m0)) ** 2;
    totalSum += (depthM - meanDepth) ** 2;
  }

  // Every sounding at the same depth: the line is flat and correct, and R² is undefined
  // rather than zero. Reported as 1 — it explains all of the (nil) variation there is.
  const r2 = totalSum === 0 ? 1 : 1 - residualSum / totalSum;
  const rmseM = Math.sqrt(residualSum / n);

  if (![m1, m0, r2, rmseM].every(Number.isFinite)) return null;
  return { m1, m0, r2, rmseM, n };
}

export function ratioToDepth(fit: DepthFit, ratio: number): number {
  return fit.m1 * ratio - fit.m0;
}

/**
 * Metres back to a ratio — what lets the threshold slider be set in metres (issue #50).
 *
 * `m1` cannot be zero: `fitDepth` only returns a fit when the ratios vary, and a zero
 * slope needs the depths to be identical *and* uncorrelated with ratio. Guarded anyway,
 * because the alternative is an Infinity threshold and a contour of the entire sea.
 */
export function depthToRatio(fit: DepthFit, depthM: number): number | null {
  if (fit.m1 === 0) return null;
  return (depthM + fit.m0) / fit.m1;
}

/** Signed residual per point, in metres: positive means the fit reads shallower than measured. */
export function residuals(fit: DepthFit, points: readonly FitPoint[]): number[] {
  return points.map((point) => point.depthM - ratioToDepth(fit, point.ratio));
}

/**
 * The arithmetic behind the map's scale bar (issue #55).
 *
 * Pure, and free of both MapLibre and the DOM, so it is testable — `apps/web` runs Vitest
 * in a node environment, the same constraint that put `toolPrompt` outside `ToolCard`.
 */

/**
 * The round distances a bar is allowed to span, as mantissae of a power of ten.
 *
 * Wider than the usual 1-2-5 on purpose. A scale bar always shows the largest round number
 * that *fits*, so the ratio between adjacent steps is the worst case for how short the bar
 * can end up: 1-2-5 steps by 2.5x, which against a half-viewport target yields a bar
 * anywhere from 20% to 50% of the screen — a quarter-screen stub more often than not. No
 * gap here exceeds 1.5x, holding the bar at 67-100% of the target, so "half the screen"
 * stays approximately true while the number on the end stays round.
 */
const MANTISSAE = [1, 1.5, 2, 3, 4, 5, 7.5];

/**
 * How many alternating blocks each mantissa is cut into.
 *
 * Chosen so every division lands on a number worth printing: 1.5 km in three is 500 m,
 * 7.5 km in three is 2.5 km. Cutting 1.5 into four would label a tick 375 m.
 */
const SEGMENTS: Record<number, number> = { 1: 4, 1.5: 3, 2: 4, 3: 3, 4: 4, 5: 5, 7.5: 3 };

export interface ScaleBar {
  /** The round distance the bar spans, in metres. */
  distanceM: number;
  /** How wide that distance is on screen, in CSS pixels. */
  widthPx: number;
  /** How many alternating blocks the bar is drawn as. */
  segments: number;
  /** Tick labels, left to right — one per division boundary, so `segments + 1` of them. */
  labels: string[];
}

/**
 * The widest round bar that fits in `targetWidthPx`.
 *
 * Returns `null` rather than a `NaN`-wide bar when the map cannot say how big a pixel is —
 * which it briefly cannot, between the canvas existing and the style loading.
 */
export function chooseScaleBar(metresPerPixel: number, targetWidthPx: number): ScaleBar | null {
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return null;
  if (!Number.isFinite(targetWidthPx) || targetWidthPx <= 0) return null;

  const targetM = metresPerPixel * targetWidthPx;

  // The decade `targetM` sits in, so `1 * decade` always fits and the search cannot come
  // back empty. Nudged up when `log10` lands a hair below an exact power of ten — without
  // it, a target of exactly 1000 m yields a 750 m bar.
  let decade = 10 ** Math.floor(Math.log10(targetM));
  if (decade * 10 <= targetM) decade *= 10;

  // Largest step that fits. `targetM < 10 * decade` by construction, so no mantissa of the
  // decade above could ever be a candidate.
  let mantissa = MANTISSAE[0];
  for (const candidate of MANTISSAE) {
    if (candidate * decade <= targetM) mantissa = candidate;
  }

  const distanceM = mantissa * decade;
  const segments = SEGMENTS[mantissa] ?? 4;
  return {
    distanceM,
    widthPx: distanceM / metresPerPixel,
    segments,
    labels: scaleLabels(distanceM, segments),
  };
}

/**
 * Tick labels for a bar of `distanceM` cut into `segments`.
 *
 * One unit for the whole bar, taken from the total, and printed only on the last label:
 * `0 · 0.5 · 1 · 1.5 · 2 km`. Switching units mid-bar — "500 m" then "1 km" — is what a
 * map sheet never does, and reading it means dividing in your head at every other tick.
 *
 * Not `formatDistanceM` from `format.ts`: that prints two decimals above a kilometre,
 * which is right for a *measured* distance whose precision is the click, and wrong on a
 * tick that is round by construction. "2.00 km" here would be noise, not precision.
 */
export function scaleLabels(distanceM: number, segments: number): string[] {
  const km = distanceM >= 1000;
  const total = km ? distanceM / 1000 : distanceM;
  const unit = km ? "km" : "m";
  return Array.from({ length: segments + 1 }, (_, i) => {
    // Round-trip through a fixed precision before dropping trailing zeros: the divisions
    // of 7.5 are 2.5, 5, 7.5 exactly, but 3/3 in binary floating point is not.
    const value = Number(((total * i) / segments).toFixed(3));
    return i === segments ? `${value} ${unit}` : String(value);
  });
}

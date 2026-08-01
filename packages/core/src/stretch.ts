export interface Range {
  min: number;
  max: number;
}

/**
 * Percentile range used to stretch a colour ramp.
 *
 * Stumpf ratios cluster in a narrow band (typically ~0.9–1.1), so a min/max
 * stretch is dominated by a handful of outlier pixels and renders the whole bay
 * as one flat colour. Clipping the tails is what makes the depth gradient legible.
 */
export function percentileRange(values: ArrayLike<number>, lowPct = 2, highPct = 98): Range | null {
  if (values.length === 0) return null;

  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  const at = (pct: number) => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.round((pct / 100) * (sorted.length - 1))),
    );
    return sorted[index];
  };

  const min = at(lowPct);
  const max = at(highPct);
  // A degenerate range would make every pixel divide by zero downstream.
  return max > min ? { min, max } : { min, max: min + Number.EPSILON };
}

/** Position of `value` within `range`, clamped to [0, 1]. */
export function normalise(value: number, range: Range): number {
  return Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min)));
}
